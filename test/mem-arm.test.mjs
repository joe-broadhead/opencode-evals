// Offline only: filesystem buffers and materialiseArm, never an OpenCode process or child process.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { sha256 } from "../src/util/canonical.mjs"
import { materialiseArm } from "../src/run/arm.mjs"

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mem-arm-")), source = join(root, "artifact"), out = join(root, "out")
  mkdirSync(join(source, "src"), { recursive: true }); mkdirSync(join(source, "skills/mem.usage"), { recursive: true }); mkdirSync(join(source, "docs"))
  const entries = {
    "package.json": JSON.stringify({ name: "@joe-broadhead/opencode-mem", version: "0.0.0", main: "./index.js", exports: { ".": "./index.js" } }),
    "index.js": 'export { default } from "./src/index.js"',
    "src/index.js": 'import { value } from "./values.js"; export default { id: "mem", value }',
    "src/values.js": 'export const value = "synthetic"',
    "skills/mem.usage/SKILL.md": "Synthetic bundled skill.",
    "docs/agent-instructions.md": "Synthetic instructions.",
  }
  for (const [file, text] of Object.entries(entries)) writeFileSync(join(source, file), text)
  const manifest = { schema: "oc-mem-arm/1", source_commit: "5".repeat(40), archive_sha256: "a".repeat(64), files: Object.fromEntries(Object.entries(entries).map(([p, t]) => [p, sha256(t)])) }
  writeFileSync(join(source, ".mem-arm.json"), JSON.stringify(manifest))
  return { root, source, out, manifest }
}

test("a hash-manifested Memory directory arm copies its real entrypoint/source/skills/docs without dist or project config", () => {
  const f = fixture()
  try {
    writeFileSync(join(f.source, "opencode.json"), '{"plugins":["not-an-artifact"]}')
    materialiseArm(f.source, f.out)
    for (const p of Object.keys(f.manifest.files)) assert.equal(readFileSync(join(f.out, p), "utf8"), readFileSync(join(f.source, p), "utf8"))
    assert.equal(existsSync(join(f.out, "opencode.json")), false)
    assert.equal(existsSync(join(f.out, "dist")), false)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("Memory copying rejects changed bytes, missing closure files, unsafe manifest paths and links before output", () => {
  for (const alter of [
    (f) => writeFileSync(join(f.source, "src/values.js"), "tampered"),
    (f) => { delete f.manifest.files["src/values.js"]; writeFileSync(join(f.source, ".mem-arm.json"), JSON.stringify(f.manifest)) },
    (f) => { f.manifest.files["../escape"] = "a".repeat(64); writeFileSync(join(f.source, ".mem-arm.json"), JSON.stringify(f.manifest)) },
    (f) => { rmSync(join(f.source, "src/values.js")); symlinkSync("index.js", join(f.source, "src/values.js")) },
  ]) {
    const f = fixture()
    try { alter(f); assert.throws(() => materialiseArm(f.source, f.out), /Memory|manifest|closure|link|digest/); assert.equal(existsSync(f.out), false) }
    finally { rmSync(f.root, { recursive: true, force: true }) }
  }
})

test("generic plugins still require dist and cannot opt in by copying Memory's manifest", () => {
  const f = fixture()
  try {
    writeFileSync(join(f.source, "package.json"), '{"name":"@demo/plugin"}')
    assert.throws(() => materialiseArm(f.source, f.out), /no dist/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
