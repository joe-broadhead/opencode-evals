// A Code Mode signature (`tools.jira.getJiraIssue({ /** doc */ cloudId: string, ... }): Promise<unknown>`) back into the JSON Schema it was drawn from.
// Used once, by `scripts/mcp-catalog.mjs`, to turn what a signed-in host lists for a plugin's MCP tools into the catalog the fake MCP server serves
// (packs/<id>/mcp.json). The rendering is lossy in one way: `Array<unknown>` has lost its item type (the doc comment usually shows it), so it comes back as
// `{ "type": "array" }`. Everything else a host prints survives: names, optionality, string literals, nested objects, and the tags on a doc comment
// (@default, @integer, @minimum, @maximum, @minLength, @maxLength, @pattern, @minItems, @maxItems).

const TAGS = { "@integer": (s) => ({ type: "integer" }), "@minimum": (s, v) => ({ minimum: Number(v) }), "@maximum": (s, v) => ({ maximum: Number(v) }), "@minLength": (s, v) => ({ minLength: Number(v) }), "@maxLength": (s, v) => ({ maxLength: Number(v) }), "@minItems": (s, v) => ({ minItems: Number(v) }), "@maxItems": (s, v) => ({ maxItems: Number(v) }), "@pattern": (s, v) => ({ pattern: v }), "@default": (s, v) => ({ default: parseDefault(v) }) }

function parseDefault(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** The description and the tags of one doc comment body. */
export function docOf(comment) {
  const text = comment.replace(/^\s*\/\*\*/, "").replace(/\*\/\s*$/, "").split("\n").map((line) => line.replace(/^\s*\*\s?/, "")).join("\n").trim()
  const first = text.search(/@(?:integer|minimum|maximum|minLength|maxLength|minItems|maxItems|pattern|default)\b/)
  const description = (first < 0 ? text : text.slice(0, first)).replace(/\s+/g, " ").trim()
  const tags = {}
  if (first >= 0) {
    const rest = text.slice(first)
    for (const m of rest.matchAll(/(@integer\b)|(@(?:minimum|maximum|minLength|maxLength|minItems|maxItems|pattern|default))(?:\s+("(?:[^"\\]|\\.)*"|\S+))?/g)) Object.assign(tags, TAGS[m[1] ?? m[2]](null, m[3]))
  }
  return { description, tags }
}

class Reader {
  constructor(text) {
    this.s = text
    this.i = 0
  }
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++
  }
  peek(n = 1) {
    return this.s.slice(this.i, this.i + n)
  }
  eat(token) {
    this.ws()
    if (this.s.startsWith(token, this.i)) {
      this.i += token.length
      return true
    }
    return false
  }
  expect(token) {
    if (!this.eat(token)) throw new Error(`expected ${JSON.stringify(token)} at ${this.i}: ${JSON.stringify(this.s.slice(this.i, this.i + 40))}`)
  }
  /** The doc comments before the next token, joined. */
  comments() {
    const found = []
    for (;;) {
      this.ws()
      if (this.s.startsWith("/**", this.i)) {
        const end = this.s.indexOf("*/", this.i)
        found.push(this.s.slice(this.i, end + 2))
        this.i = end + 2
      } else if (this.s.startsWith("//", this.i)) {
        const end = this.s.indexOf("\n", this.i)
        this.i = end < 0 ? this.s.length : end
      } else return found
    }
  }
}

function parseKey(r) {
  r.ws()
  if (r.peek() === "[") {
    const end = r.s.indexOf("]", r.i)
    r.i = end + 1
    return { index: true }
  }
  if (r.peek() === '"') {
    const m = /^"((?:[^"\\]|\\.)*)"/.exec(r.s.slice(r.i))
    r.i += m[0].length
    return { name: JSON.parse(m[0]) }
  }
  const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(r.s.slice(r.i))
  if (!m) throw new Error(`no key at ${r.i}: ${JSON.stringify(r.s.slice(r.i, r.i + 40))}`)
  r.i += m[0].length
  return { name: m[0] }
}

function parseObject(r) {
  r.expect("{")
  const properties = {}
  const required = []
  let additional = null
  for (;;) {
    const docs = r.comments()
    r.ws()
    if (r.eat("}")) break
    const key = parseKey(r)
    const optional = r.eat("?")
    r.expect(":")
    let schema = parseType(r)
    const { description, tags } = docs.length ? docOf(docs.join("\n")) : { description: "", tags: {} }
    schema = { ...schema, ...tags, ...(description ? { description } : {}) }
    // an @integer tag on a number is an integer, on anything else it is ignored
    if (key.index) additional = schema.description || schema.type ? schema : true
    else {
      properties[key.name] = schema
      if (!optional) required.push(key.name)
    }
    r.ws()
    r.eat(",")
    r.eat(";")
  }
  return { type: "object", properties, ...(required.length ? { required } : {}), ...(additional !== null ? { additionalProperties: additional === true ? {} : { ...additional, description: undefined } } : {}) }
}

function parseAtom(r) {
  r.ws()
  const c = r.peek()
  if (c === "{") return parseObject(r)
  if (c === '"') {
    const m = /^"((?:[^"\\]|\\.)*)"/.exec(r.s.slice(r.i))
    r.i += m[0].length
    return { type: "string", enum: [JSON.parse(m[0])] }
  }
  const word = /^[A-Za-z_$][A-Za-z0-9_$.]*/.exec(r.s.slice(r.i))
  if (!word) throw new Error(`no type at ${r.i}: ${JSON.stringify(r.s.slice(r.i, r.i + 40))}`)
  r.i += word[0].length
  switch (word[0]) {
    case "string":
      return { type: "string" }
    case "number":
      return { type: "number" }
    case "boolean":
      return { type: "boolean" }
    case "null":
      return { type: "null" }
    case "unknown":
    case "any":
      return {}
    case "Array":
    case "ReadonlyArray": {
      r.expect("<")
      const items = parseType(r)
      r.expect(">")
      return Object.keys(items).length ? { type: "array", items } : { type: "array" }
    }
    case "Record": {
      r.expect("<")
      parseType(r)
      r.expect(",")
      const value = parseType(r)
      r.expect(">")
      return { type: "object", additionalProperties: Object.keys(value).length ? value : {} }
    }
    default:
      return {}
  }
}

/** A union of atoms: string literals merge into one enum, anything else becomes `anyOf`. */
function parseType(r) {
  const atoms = [parseAtom(r)]
  while (r.eat("|")) atoms.push(parseAtom(r))
  let schema
  if (atoms.length === 1) schema = atoms[0]
  else if (atoms.every((a) => a.type === "string" && a.enum)) schema = { type: "string", enum: atoms.flatMap((a) => a.enum) }
  else schema = { anyOf: atoms }
  // `T[]` suffixes
  while (r.peek(2) === "[]") {
    r.i += 2
    schema = { type: "array", items: schema }
  }
  return schema
}

/** `{ name, input }` of a Code Mode signature: the tool's own name and the JSON Schema of its one argument. */
export function parseSignature(signature) {
  const head = /^tools\.(?:[A-Za-z0-9_$]+)(?:\.([A-Za-z0-9_$]+)|\["([^"]+)"\]\["([^"]+)"\])\(/.exec(signature) ?? /^tools(?:\.[A-Za-z0-9_$]+|\["[^"]+"\])*\.([A-Za-z0-9_$-]+)\(/.exec(signature)
  if (!head) throw new Error(`not a tool signature: ${JSON.stringify(signature.slice(0, 60))}`)
  const name = head[1] ?? head[3] ?? head[2]
  const r = new Reader(signature)
  r.i = head[0].length
  r.ws()
  if (r.peek() === ")") return { name, input: { type: "object", properties: {} } }
  return { name, input: parseObject(r) }
}
