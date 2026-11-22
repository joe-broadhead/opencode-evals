/**
 * The vault export: a gzip tar of Markdown files with YAML frontmatter, which
 * opens as an Obsidian vault (contract §2.4 `records.export`).
 *
 * - A page is `<path>.md`, a memory `memories/<id>.md`, a commitment
 *   `commitments/<id>.md`, a proposal `proposals/<id>.md`.
 * - `aliases` and `tags` sit at the top level, where Obsidian reads them; the
 *   other fields are one JSON (YAML flow) mapping under `fields`.
 * - Strings are JSON-quoted, which is valid YAML, except a few token values
 *   (ids, kinds, statuses, paths, ISO dates) that are written plain.
 * - The body follows the closing `---` verbatim, plus one newline.
 */
import { gzipSync } from "node:zlib"

const PLAIN = /^[A-Za-z0-9][A-Za-z0-9_./:+-]*$/
const AMBIGUOUS = /^(?:true|false|yes|no|on|off|null|~|[-+]?\d[\d_]*(?:\.\d+)?(?:e[-+]?\d+)?|0x[0-9a-f]+|0o[0-7]+)$/i

function scalar(value) {
  if (value === null || value === undefined) return "null"
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  const text = String(value)
  return PLAIN.test(text) && !AMBIGUOUS.test(text) ? text : JSON.stringify(text)
}

function list(key, values) {
  if (!values || values.length === 0) return `${key}: []\n`
  return `${key}:\n${values.map((value) => `  - ${scalar(value)}\n`).join("")}`
}

export function exportFileName(record) {
  if (record.kind === "page") return `${record.path}.md`
  if (record.kind === "memory") return `memories/${record.id}.md`
  if (record.kind === "commitment") return `commitments/${record.id}.md`
  return `proposals/${record.id}.md`
}

/** One record as a Markdown file with YAML frontmatter. */
export function toMarkdown(record) {
  const { aliases, tags, ...fields } = record.fields ?? {}
  let yaml = ""
  yaml += `id: ${scalar(record.id)}\n`
  yaml += `kind: ${scalar(record.kind)}\n`
  yaml += `type: ${scalar(record.type)}\n`
  if (record.path) yaml += `path: ${scalar(record.path)}\n`
  yaml += `title: ${JSON.stringify(record.title ?? "")}\n`
  yaml += `status: ${scalar(record.status)}\n`
  yaml += `stated_by: ${scalar(record.stated_by)}\n`
  if (Array.isArray(aliases)) yaml += list("aliases", aliases)
  if (Array.isArray(tags)) yaml += list("tags", tags)
  yaml += `owner: ${scalar(record.owner)}\n`
  yaml += `author: ${JSON.stringify(record.author ?? {})}\n`
  yaml += `created: ${scalar(record.created)}\n`
  yaml += `updated: ${scalar(record.updated)}\n`
  yaml += `version: ${record.version}\n`
  yaml += list("supersedes", record.supersedes)
  if (record.superseded_by) yaml += `superseded_by: ${scalar(record.superseded_by)}\n`
  if (record.task) yaml += `task: ${scalar(record.task)}\n`
  if (record.source && Object.keys(record.source).length > 0) yaml += `source: ${JSON.stringify(record.source)}\n`
  yaml += list("links", record.links)
  if (aliases !== undefined && !Array.isArray(aliases)) fields.aliases = aliases
  if (tags !== undefined && !Array.isArray(tags)) fields.tags = tags
  if (Object.keys(fields).length > 0) yaml += `fields: ${JSON.stringify(fields)}\n`
  return `---\n${yaml}---\n${record.body ?? ""}\n`
}

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, "0")}\0`
}

function header(name, size, mtime, type = "0") {
  const block = Buffer.alloc(512)
  block.write(name.slice(0, 100), 0, 100, "utf8")
  block.write(octal(0o644, 8), 100, 8, "ascii")
  block.write(octal(0, 8), 108, 8, "ascii")
  block.write(octal(0, 8), 116, 8, "ascii")
  block.write(octal(size, 12), 124, 12, "ascii")
  block.write(octal(mtime, 12), 136, 12, "ascii")
  block.fill(0x20, 148, 156)
  block.write(type, 156, 1, "ascii")
  block.write("ustar\0", 257, 6, "ascii")
  block.write("00", 263, 2, "ascii")
  let sum = 0
  for (const byte of block) sum += byte
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii")
  return block
}

function pad(length) {
  const rest = length % 512
  return rest === 0 ? Buffer.alloc(0) : Buffer.alloc(512 - rest)
}

/** A PAX record: "<length> path=<value>\n", where length counts itself. */
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`
  let length = Buffer.byteLength(body) + 1
  while (String(length).length + Buffer.byteLength(body) !== length) length = String(length).length + Buffer.byteLength(body)
  return `${length}${body}`
}

/**
 * A ustar archive of `[{name, content}]`, gzipped. A name longer than 100
 * bytes travels in a PAX header.
 * @param {Array<{name: string, content: string}>} files
 * @param {number} mtime seconds since the epoch
 */
export function tarGz(files, mtime = Math.floor(Date.now() / 1000)) {
  const parts = []
  for (const file of files) {
    const data = Buffer.from(file.content, "utf8")
    if (Buffer.byteLength(file.name) > 100) {
      const pax = Buffer.from(paxRecord("path", file.name), "utf8")
      parts.push(header(`PaxHeader/${file.name.slice(-80)}`, pax.length, mtime, "x"), pax, pad(pax.length))
    }
    parts.push(header(file.name, data.length, mtime), data, pad(data.length))
  }
  parts.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(parts))
}
