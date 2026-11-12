// Code Mode's inner calls, with their arguments.
//
// The outer `execute` event carries `code`; the calls the code makes are `tools.<ns>.<name>(…)`. A regex
// finds the call sites (a lower bound: a loop counts once), and this module then reads the argument
// object literal beside each site. Only literals are understood — a string, a number, a boolean, an
// object, an array, or a reference to a local variable. Inside an object or an array, any other value (a call, a
// ternary, `new Date(…)`) is kept as an unseen variable and a spread (`...opts`) as `$spread: true`, so the literal
// keys beside them still count; a spread means a key not written may still have been passed. Anything else is
// reported as unparsed, and the item that needed it becomes BLOCKED rather than guessed at. Nothing is executed.

const CALL = /tools(?:\.([A-Za-z_$][\w$]*)|\[["']([^"']+)["']\])+?\s*\(/g

/** The dotted path after `tools.`, e.g. `tools.x.search_posts_all(` -> ["x","search_posts_all"]. */
function pathOf(match) {
  const text = match.replace(/\s*\($/, "")
  const parts = []
  const re = /\.([A-Za-z_$][\w$]*)|\[["']([^"']+)["']\]/g
  let m
  while ((m = re.exec(text))) parts.push(m[1] ?? m[2])
  return parts
}

/** Reads a balanced (...) starting at `open` (which indexes the "("). Returns the inside text. */
function balanced(code, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < code.length; i++) {
    const ch = code[i]
    if (quote) {
      if (ch === "\\") i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      continue
    }
    if (ch === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i++
      continue
    }
    if (ch === "/" && code[i + 1] === "*") {
      i += 2
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++
      i++
      continue
    }
    if (ch === "(" || ch === "{" || ch === "[") depth++
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth--
      if (depth === 0) return code.slice(open + 1, i)
    }
  }
  return null
}

const isSpace = (ch) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r"

/** A literal object/array/primitive reader. Returns {ok, value} or {ok:false, why}. */
export function readLiteral(text) {
  let i = 0
  const fail = (why) => ({ ok: false, why })
  const skip = () => {
    for (;;) {
      while (i < text.length && isSpace(text[i])) i++
      if (text[i] === "/" && text[i + 1] === "/") {
        while (i < text.length && text[i] !== "\n") i++
        continue
      }
      if (text[i] === "/" && text[i + 1] === "*") {
        i += 2
        while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
        i += 2
        continue
      }
      return
    }
  }
  const readString = () => {
    const quote = text[i++]
    let out = ""
    while (i < text.length && text[i] !== quote) {
      if (text[i] === "\\") {
        const next = text[i + 1]
        i += 2
        out += next === "n" ? "\n" : next === "t" ? "\t" : next
      } else out += text[i++]
    }
    i++
    return out
  }
  const readKey = () => {
    skip()
    if (text[i] === '"' || text[i] === "'") return readString()
    const start = i
    while (i < text.length && /[A-Za-z0-9_$]/.test(text[i])) i++
    return text.slice(start, i)
  }
  // Skips one expression we do not read (a call, a ternary, an operator chain), up to the `,` or the closing
  // bracket that ends it at this depth. Returns false when the text ends first.
  const skipExpression = () => {
    let depth = 0
    let quote = null
    for (; i < text.length; i++) {
      const c = text[i]
      if (quote) {
        if (c === "\\") i++
        else if (c === quote) quote = null
        continue
      }
      if (c === '"' || c === "'" || c === "`") quote = c
      else if (c === "(" || c === "{" || c === "[") depth++
      else if (c === ")" || c === "}" || c === "]") {
        if (depth === 0) return true
        depth--
      } else if (c === "," && depth === 0) return true
    }
    return false
  }
  // One element of an object or an array: a literal, or an unseen expression kept as a variable.
  const readElement = () => {
    skip()
    const start = i
    const value = readValue()
    skip()
    if (value.ok && (text[i] === "," || text[i] === "}" || text[i] === "]")) return value
    i = start
    if (!skipExpression()) return fail(`unterminated expression at ${start}`)
    return { ok: true, value: { $ref: "(expression)" }, literal: "ref" }
  }
  const readValue = () => {
    skip()
    const ch = text[i]
    if (ch === "{") {
      i++
      const obj = {}
      for (;;) {
        skip()
        if (text[i] === "}") {
          i++
          return { ok: true, value: obj }
        }
        if (i >= text.length) return fail("unterminated object")
        if (text.startsWith("...", i)) {
          // A spread: any key may come from it. The literal keys beside it are still read.
          i += 3
          if (!skipExpression()) return fail("unterminated spread")
          obj.$spread = true
          if (text[i] === ",") i++
          continue
        }
        const key = readKey()
        if (!key) return fail(`unreadable key at ${i}`)
        skip()
        if (text[i] !== ":") {
          // A shorthand property (`{ id, start_time: … }`): the value is the local binding, not a literal.
          if (text[i] === "," || text[i] === "}") {
            obj[key] = { $ref: key }
            if (text[i] === ",") {
              i++
              continue
            }
            i++
            return { ok: true, value: obj }
          }
          return fail(`expected ":" after ${key}`)
        }
        i++
        const value = readElement()
        if (!value.ok) return value
        obj[key] = value.value
        skip()
        if (text[i] === ",") {
          i++
          continue
        }
        if (text[i] === "}") {
          i++
          return { ok: true, value: obj }
        }
        return fail("expected , or }")
      }
    }
    if (ch === "[") {
      i++
      const arr = []
      for (;;) {
        skip()
        if (text[i] === "]") {
          i++
          return { ok: true, value: arr }
        }
        if (text.startsWith("...", i)) {
          // A spread into a list: its elements are unseen.
          i += 3
          if (!skipExpression()) return fail("unterminated spread")
          arr.push({ $ref: "(spread)" })
          if (text[i] === ",") i++
          continue
        }
        const value = readElement()
        if (!value.ok) return value
        arr.push(value.value)
        skip()
        if (text[i] === ",") {
          i++
          continue
        }
        if (text[i] === "]") {
          i++
          return { ok: true, value: arr }
        }
        return fail("expected , or ]")
      }
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const value = readString()
      return { ok: true, value, literal: "string" }
    }
    const rest = text.slice(i)
    const num = /^-?\d+(?:\.\d+)?/.exec(rest)
    if (num) {
      i += num[0].length
      return { ok: true, value: Number(num[0]), literal: "number" }
    }
    for (const [word, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
      ["undefined", null],
    ]) {
      if (rest.startsWith(word) && !/[A-Za-z0-9_$]/.test(rest[word.length] ?? "")) {
        i += word.length
        return { ok: true, value, literal: word }
      }
    }
    const ident = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(rest)
    if (ident) {
      i += ident[0].length
      return { ok: true, value: { $ref: ident[0] }, literal: "ref" }
    }
    return fail(`unreadable value at ${i}`)
  }
  const value = readValue()
  skip()
  return value.ok ? { ok: true, value: value.value } : value
}

/**
 * Every `tools.<ns>.<name>(…)` site in one execute call.
 * @returns {Array<{ns: string|null, name: string, args: unknown|undefined, parsed: boolean, why?: string}>}
 */
export function extractInnerCalls(code) {
  if (typeof code !== "string") return []
  const out = []
  CALL.lastIndex = 0
  let match
  while ((match = CALL.exec(code))) {
    const parts = pathOf(match[0])
    const open = match.index + match[0].length - 1
    const inside = balanced(code, open)
    if (inside === null) {
      out.push({ ns: null, name: parts.join(".") || "unknown", args: undefined, parsed: false, why: "unbalanced call" })
      continue
    }
    const trimmed = inside.trim()
    const name = parts[parts.length - 1] ?? "unknown"
    const ns = parts.length > 1 ? parts.slice(0, -1).join(".") : null
    if (!trimmed || /^\)?$/.test(trimmed)) {
      out.push({ ns, name, args: {}, parsed: true })
      continue
    }
    const literal = readLiteral(trimmed)
    if (!literal.ok) {
      out.push({ ns, name, args: undefined, parsed: false, why: literal.why })
      continue
    }
    out.push({ ns, name, args: literal.value, parsed: true })
  }
  return out
}

/**
 * Which local variable holds each call's result, and what the block returns. This is a syntactic
 * binding, not a guess: `const m = await tools.x.get_users_mentions(…)` binds `m`, and `return {…, m}`
 * says the payload is under that key.
 * @returns {{bindings: Map<string,string>, returns: unknown|undefined}}
 */
export function dataflow(code) {
  const bindings = new Map()
  if (typeof code !== "string") return { bindings, returns: undefined }
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?tools(?:\.[A-Za-z_$][\w$]*|\["[^"]+"\])+\s*\(/g)) {
    const parts = pathOf(m[0])
    const tool = parts[parts.length - 1]
    bindings.set(m[1], tool)
  }
  const at = code.lastIndexOf("return")
  if (at >= 0) {
    const rest = code.slice(at + "return".length).trim()
    if (rest.startsWith("{")) {
      const inside = balanced(rest, 0)
      if (inside !== null) {
        const literal = readLiteral(`{${inside}}`)
        if (literal.ok) {
          const ret = literal.value
          // `{m}` parses as {$ref:"m"}; normalise to the same shape as `{m: x}`.
          return { bindings, returns: ret }
        }
      }
    }
    const literal = readLiteral(rest.replace(/;\s*$/, ""))
    if (literal.ok) return { bindings, returns: literal.value }
  }
  return { bindings, returns: undefined }
}

/** The key in the returned object that holds a call's payload, or null when the binding is not clear. */
export function returnKeyFor(returns, variable) {
  if (!returns || typeof returns !== "object" || Array.isArray(returns)) return null
  for (const [key, value] of Object.entries(returns)) {
    if (key === variable) return key
    if (value && typeof value === "object" && value.$ref) {
      const ref = String(value.$ref)
      if (ref === variable || ref.startsWith(`${variable}.`)) return key
    }
  }
  return null
}
