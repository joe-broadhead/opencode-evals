import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { derivePack } from "../src/pack/from-plugin.mjs"
import { verifySnapshot } from "../src/pack/snapshot.mjs"

test("Memory's JS entrypoint and absent access option remain honest in a derived source pack", () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-pack-"))
  try {
    mkdirSync(join(dir, "src"))
    writeFileSync(join(dir, "src/index.js"), 'export default { id: "mem", setup() {} }')
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@joe-broadhead/opencode-mem", version: "0.0.0", jelly: { tools: [{ name: "mem.recall", permission: "mem_recall", effect: "allow", readOnly: true }] } }))
    const pack = derivePack("mem", dir)
    assert.equal(pack.pluginId, "mem")
    assert.equal(pack.rpc, "mem.tools")
    assert.equal(pack.access, undefined, "do not invent an access option the baseline does not declare")
    assert.equal(verifySnapshot({ ...pack, t1: [] }).ok, false, "adding fields changes the digest")
    assert.equal(verifySnapshot(pack).ok, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
