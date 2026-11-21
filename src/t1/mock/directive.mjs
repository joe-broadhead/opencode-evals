// The scripted model's directive, read from the last user message. Kept out of the Bun server so the parser can be
// tested with `node --test`, without a host, a container or a model.
//
//   [[mock:text:SOME TEXT]]        a plain answer
//   [[mock:slow:N]]                N one-second chunks, then "slow done"
//   [[mock:tool:NAME:JSON]]        one tool call, then text after its result
//   [[mock:steps:JSON]]            a sequence: one call per turn, `{{previous.<path>}}` filled from the last result
//   [[mock:dump]]                  log the request body, then a short answer
//   [[mock:schema]]                log the tools the request carried
//
// Two things the old regex could not carry:
//   - a `]` in a JSON argument (an array, an index, `.map(...)`) ended the directive early. The payload is now read
//     with a bracket- and string-aware scan, so `[{"tool":"gws_write"}]` survives;
//   - a prompt that reached the model JSON-escaped (`{\"code\":\"…\"}`) needed one unescape, which also corrupted a
//     payload that legitimately holds `\"` (Notion's `JSON.parse("{\\\"properties\\\"…}")`). A JSON payload is parsed
//     as it stands first, and unescaped only when it does not parse; a plain answer is unescaped only when it is
//     visibly escaped (holds `\"` and no `"`).

const OPEN = "[[mock:"

/** Where the directive's argument ends: the first `]]` at bracket depth 0, outside a JSON string. */
function scan(text, from) {
  let depth = 0
  let quote = false
  let i = from
  while (i < text.length) {
    const ch = text[i]
    if (quote) {
      if (ch === "\\") {
        i += 2
        continue
      }
      if (ch === '"') quote = false
      i += 1
      continue
    }
    if (ch === '"') {
      quote = true
      i += 1
      continue
    }
    if (ch === "[" || ch === "{") depth += 1
    else if (ch === "]" || ch === "}") {
      if (depth > 0) {
        depth -= 1
        i += 1
        continue
      }
      if (text.startsWith("]]", i)) return i
    }
    i += 1
  }
  return text.length
}

/** The first directive in the text as it stands: `{ kind, arg }`, or null. Never unescapes. */
export function splitDirective(text) {
  const source = String(text ?? "")
  const start = source.indexOf(OPEN)
  if (start < 0) return null
  let i = start + OPEN.length
  const kind = /^\w+/.exec(source.slice(i))?.[0]
  if (!kind) return null
  i += kind.length
  if (source.startsWith("]]", i)) return { kind, arg: "" }
  if (source[i] !== ":") return null
  const from = i + 1
  const end = scan(source, from)
  return { kind, arg: source.slice(from, end) }
}

/** One unescape, the way a JSON string carries the prompt. Only used when the raw payload does not parse. */
export const unescape = (text) => String(text).replace(/\\"/g, '"').replace(/\\n/g, "\n")

const splitTool = (arg) => {
  const at = arg.indexOf(":")
  return at < 0 ? { name: arg, json: "{}" } : { name: arg.slice(0, at), json: arg.slice(at + 1) }
}

const parseJson = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Does this payload stand as a tool's arguments or a step list? */
function parses(kind, arg) {
  if (kind === "tool") return Boolean(splitTool(arg).name) && parseJson(splitTool(arg).json) !== undefined
  if (kind === "steps") return Array.isArray(parseJson(arg))
  return true
}

/**
 * The directive the request carries: `{ kind, arg }`. The raw text is preferred whenever its payload is well formed;
 * a payload that only parses after one unescape is the prompt having arrived JSON-escaped, so that is used instead.
 * No directive is `{ kind: "text", arg: "hello from mock" }` (the server's own default answer).
 */
export function directiveOf(text) {
  const raw = String(text ?? "")
  const first = splitDirective(raw)
  if (!first) return { kind: "text", arg: "hello from mock" }
  if (parses(first.kind, first.arg)) {
    // A plain answer can still have arrived escaped: unescape only when nothing would be lost by it.
    if (first.kind === "text" && first.arg.includes('\\"') && !first.arg.includes('"')) return { kind: "text", arg: unescape(first.arg) }
    return first
  }
  const second = splitDirective(unescape(raw))
  if (second && parses(second.kind, second.arg)) return second
  return first
}

/** A `tool` directive's name and parsed arguments, or null when it is not one or its JSON does not parse. */
export function parseToolDirective(kind, arg) {
  if (kind !== "tool") return null
  const { name, json } = splitTool(arg)
  if (!name) return null
  const args = parseJson(json)
  return args === undefined ? null : { name, args }
}

/**
 * The last tool result as a tree: a JSON string (or a JSON string of one) is parsed, and a content part
 * (`{ type: "text", text }`, MCP's shape) is replaced by the JSON its text carries when it carries JSON.
 */
export function previousValue(content) {
  const walk = (value, depth) => {
    if (depth > 6) return value
    if (typeof value === "string") {
      const parsed = parseJson(value)
      return parsed === undefined ? value : walk(parsed, depth + 1)
    }
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1))
    if (value && typeof value === "object") {
      if (typeof value.type === "string" && typeof value.text === "string" && /^(text|json)$/.test(value.type)) return walk(value.text, depth + 1)
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, walk(inner, depth + 1)]))
    }
    return value
  }
  return walk(content, 0)
}

/** The value at a dotted path, or the first value for its last segment found in the envelope (depth ≤ 5). */
export function atPath(value, path) {
  const keys = String(path).split(".").filter(Boolean)
  let current = value
  for (const key of keys) {
    if (current === null || typeof current !== "object") break
    current = Array.isArray(current) ? (/^\d+$/.test(key) ? current[Number(key)] : undefined) : current[key]
  }
  if (current !== undefined) return current
  const leaf = keys[keys.length - 1]
  const seen = new Set()
  const queue = [[value, 0]]
  while (queue.length) {
    const [item, depth] = queue.shift()
    if (!item || typeof item !== "object" || depth > 5 || seen.has(item)) continue
    seen.add(item)
    if (!Array.isArray(item) && leaf in item) return item[leaf]
    for (const inner of Array.isArray(item) ? item : Object.values(item)) queue.push([inner, depth + 1])
  }
  return undefined
}

/** `{{previous.<path>}}` in a step's arguments, filled from the previous result; a missing value is filled with "". */
export function fillPrevious(value, previous) {
  if (typeof value === "string") {
    return value.replace(/\{\{previous\.([A-Za-z0-9_.-]+)\}\}/g, (_, path) => {
      const found = atPath(previous, path)
      return found === undefined || found === null ? "" : typeof found === "string" ? found : JSON.stringify(found)
    })
  }
  if (Array.isArray(value)) return value.map((item) => fillPrevious(item, previous))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fillPrevious(inner, previous)]))
  return value
}
