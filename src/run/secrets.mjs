// Scrubbing a run's secrets (the access token a run is given, a key passed through) from everything the runner writes:
// by exact value, in text and in files. On disk the value is masked with as many `*` as it has characters, so a
// database or any other file keeps its layout; in text the same mask is used, so a recording stays valid JSON.

import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** A function that replaces every secret in a string (or a Buffer) by its mask. */
export function redactor(secrets = []) {
  const values = [...new Set(secrets.filter((value) => typeof value === "string" && value.length >= 8))].sort((a, b) => b.length - a.length)
  const text = (input) => {
    if (input === null || input === undefined || !values.length) return input
    let out = String(input)
    for (const value of values) if (out.includes(value)) out = out.split(value).join("*".repeat(value.length))
    return out
  }
  text.buffer = (buffer) => {
    if (!values.length) return { buffer, changed: false }
    let changed = false
    for (const value of values) {
      const needle = Buffer.from(value)
      let at = buffer.indexOf(needle)
      while (at >= 0) {
        buffer.fill(0x2a, at, at + needle.length)
        changed = true
        at = buffer.indexOf(needle, at + needle.length)
      }
    }
    return { buffer, changed }
  }
  text.active = values.length > 0
  return text
}

/** Masks every secret in every regular file under `root` (links are not followed). Returns the files it changed. */
export function scrubTree(root, redact) {
  if (!redact.active) return []
  const changed = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && lstatSync(path).size <= 256 * 1024 * 1024) {
        const result = redact.buffer(readFileSync(path))
        if (result.changed) {
          writeFileSync(path, result.buffer)
          changed.push(path)
        }
      }
    }
  }
  walk(root)
  return changed
}

// Every secret this process has handed a run, so that any text is scrubbed before it is cut: a value straddling a
// cut would otherwise leave its tail behind, which no exact-value scrub of the cut text can find.
const known = new Set()

/** Registers secrets (the batch's token or keys, each run's password) for scrub() and tail(). */
export function registerSecrets(values = []) {
  for (const value of values) if (typeof value === "string" && value.length >= 8) known.add(value)
}

/** Every registered secret masked in `text`. */
export const scrub = (text) => redactor([...known])(text)

/** The last `n` characters of `text`, scrubbed first and cut after. Use this wherever output is truncated. */
export const tail = (text, n) => String(scrub(String(text ?? ""))).slice(-n)
