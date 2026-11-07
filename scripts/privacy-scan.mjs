// A broad privacy sweep over every stored trace: every link, handle and long id in a recording's
// *content* (tool arguments, tool results, answer text) must be absent from that recording's trace.
// Run: node scripts/privacy-scan.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const rawRoot = join(root, "..", "private", "raw")
const traces = join(root, "traces")

const contentOf = (raw) => {
  const parts = []
  for (const line of raw.split("\n").filter(Boolean)) {
    const event = JSON.parse(line)
    const state = event.part?.state ?? {}
    parts.push(JSON.stringify(state.input ?? {}))
    parts.push(typeof state.output === "string" ? state.output : JSON.stringify(state.output ?? ""))
    if (event.type === "text") parts.push(event.part?.text ?? "")
  }
  return parts.join("\n")
}

const isEpoch = (digits) => {
  const value = Number(digits)
  return (value > 1.6e9 && value < 1.9e9) || (value > 1.6e12 && value < 1.9e12)
}

let checked = 0
let leaks = 0
let files = 0
for (const iteration of readdirSync(rawRoot)) {
  const dir = join(rawRoot, iteration, "x")
  if (!existsSync(dir)) continue
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    const caseName = file.replace(/\.jsonl$/, "")
    const traceFile = join(traces, iteration, `${caseName}.trace.jsonl`)
    if (!existsSync(traceFile)) continue
    files++
    const text = contentOf(readFileSync(join(dir, file), "utf8"))
    const trace = readFileSync(traceFile, "utf8")
    const candidates = new Set()
    for (const m of text.matchAll(/https?:\/\/[^\s"'\\)]+/g)) candidates.add(m[0])
    for (const m of text.matchAll(/@[A-Za-z0-9_]{3,}/g)) candidates.add(m[0])
    for (const m of text.matchAll(/\b\d{10,}\b/g)) if (!isEpoch(m[0])) candidates.add(m[0])
    checked += candidates.size
    for (const value of candidates) {
      if (trace.includes(value)) {
        leaks++
        console.log(`LEAK ${iteration}/${caseName}: ${value.slice(0, 48)}`)
      }
    }
  }
}
console.log(`${files} traces scanned, ${checked} candidate values, ${leaks} leak(s)`)
process.exitCode = leaks ? 1 : 0
