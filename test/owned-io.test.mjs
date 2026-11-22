import { test } from "node:test"
import assert from "node:assert/strict"
import { createBoundedReader, measureOwnedWork, validateOwnedInputs } from "../src/run/owned-io.mjs"
function reader() {
  const nodes = new Map([
    ["/work", { dev: 1, ino: 2, directory: true }],
    ["/work/sub", { dev: 1, ino: 3, directory: true }],
    ["/work/sub/raw.jsonl", { dev: 1, ino: 4, size: 3, nlink: 1, bytes: Buffer.from("raw") }],
  ])
  const stat = p => { const n = nodes.get(p); if (!n) throw new Error("missing"); return { ...n, isDirectory: () => !!n.directory, isFile: () => !n.directory && !n.link, isSymbolicLink: () => !!n.link } }
  let reads = 0, closed = 0
  const io = { realpathSync: p => p, lstatSync: stat, openSync: p => p, fstatSync: stat, readFileSync: p => { reads++; return nodes.get(p).bytes }, closeSync() { closed++ } }
  return { read: createBoundedReader("/work", { dev: 1, ino: 2 }, io), nodes, reads: () => reads, closed: () => closed }
}
test("fixed reader refuses symlink ancestors, reused roots, hardlinks, specials, traversal and oversized data", () => {
  const good = reader()
  assert.equal(good.read("sub/raw.jsonl", 3).toString(), "raw")
  assert.equal(good.closed(), 1)
  for (const mutate of [f => f.nodes.get("/work").ino++, f => f.nodes.get("/work/sub").link = true, f => f.nodes.get("/work/sub/raw.jsonl").nlink = 2, f => f.nodes.get("/work/sub/raw.jsonl").directory = true, f => f.nodes.get("/work/sub/raw.jsonl").size = 100]) {
    const f = reader(); mutate(f); assert.throws(() => f.read("sub/raw.jsonl", 3)); assert.equal(f.reads(), 0)
  }
  for (const path of ["../plugin.mjs", "/world.mjs", "sub/../raw.jsonl", "sub//raw.jsonl"]) assert.throws(() => reader().read(path, 3))
})
test("disk watchdog includes full work root and fails closed on missing measurement or free-space proof", async () => {
  const good = { measure: async () => ({ bytes: 100, inodes: 2, unmeasurable: null }), statfs: async () => ({ bavail: 1000000, bsize: 4096, files: 1000000, ffree: 900000 }) }
  assert.equal(await measureOwnedWork("/work", good), true)
  for (const deps of [{ ...good, measure: async () => ({ unmeasurable: "denied" }) }, { ...good, statfs: async () => { throw new Error("missing") } }, { ...good, statfs: async () => ({ bavail: 0, bsize: 4096, files: 100, ffree: 0 }) }]) assert.equal(await measureOwnedWork("/work", deps), false)
})

test("parent input validation requires complete minimal roots and Linux executables before allocation", () => {
  const elf = Buffer.alloc(64); elf.write("\x7fELF"); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(62, 18)
  const nodes = new Map([["/work", null], ["/inputs", null], ["/bin-stage", null], ["/bin-stage/node", elf], ["/bin-stage/opencode", elf]])
  const stat = p => { if (!nodes.has(p)) throw new Error("missing"); const bytes = nodes.get(p); return { dev: 1, ino: p.length, mode: 0o755, nlink: 1, size: bytes?.length ?? 0, isDirectory: () => bytes === null, isFile: () => bytes !== null, isSymbolicLink: () => false } }
  const io = { realpathSync: p => p, lstatSync: stat, readdirSync: dir => [...nodes.keys()].filter(p => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/")).map(p => p.slice(dir.length + 1)), openSync: p => p, fstatSync: stat, readFileSync: p => nodes.get(p), closeSync() {} }
  const plan = { work: "/work", inputs: "/inputs", binaries: "/bin-stage", architecture: "x64", descriptor: { options: {} } }
  assert.throws(() => validateOwnedInputs(plan, io), /minimal/)
  for (const dir of ["harness", "arm", "cases"]) nodes.set(`/inputs/${dir}`, null)
  for (const name of ["caps.json", "models.json", "model-map.json"]) nodes.set(`/inputs/${name}`, Buffer.from("{}"))
  const original = validateOwnedInputs(plan, io)
  assert.deepEqual(original.work, { dev: 1, ino: 5 })
  nodes.set("/inputs/arm/main.mjs", Buffer.from("export const fixture = true"))
  assert.notEqual(validateOwnedInputs(plan, io).inputs_sha256, original.inputs_sha256)
  nodes.set("/bin-stage/node", Buffer.from("not a Linux binary"))
  assert.throws(() => validateOwnedInputs(plan, io), /Linux binary/)
})
