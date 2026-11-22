// In-memory synthetic tar bytes only. No tar subprocess or package manager.
import { test } from "node:test"
import assert from "node:assert/strict"
import { gzipSync } from "node:zlib"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { sha256 } from "../src/util/canonical.mjs"
import { stageMemoryTarball } from "../src/run/mem-arm.mjs"
import { materialiseArm } from "../src/run/arm.mjs"
function tar(entries) {
  const blocks = []
  for (const [name, body, type = "0"] of entries) {
    const text = Buffer.from(body), h = Buffer.alloc(512)
    h.write(`package/${name}`); h.write("0000644\0",100); h.write("0000000\0",108); h.write("0000000\0",116); h.write(text.length.toString(8).padStart(11,"0")+"\0",124); h.write("00000000000\0",136); h.fill(32,148,156); h.write(type,156); h.write("ustar\0",257)
    h.write([...h].reduce((a,b)=>a+b,0).toString(8).padStart(6,"0")+"\0 ",148)
    blocks.push(h,text,Buffer.alloc((512-text.length%512)%512))
  }
  return gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)]))
}
const entries = () => [
  ["package.json", JSON.stringify({name:"@joe-broadhead/opencode-mem",version:"0.0.0",main:"./index.js"})],
  ["index.js",'export { default } from "./src/index.js"'], ["src/index.js",'export default { id: "mem" }'],
  ["skills/mem.usage/SKILL.md","Synthetic skill."], ["docs/agent-instructions.md","Synthetic instructions."],
]
test("verified versioned tar bytes stage the exact Memory import closure and carry archive provenance", () => {
  const root = mkdtempSync(join(tmpdir(),"mem-tar-"))
  try {
    const bytes = tar(entries()), stage=join(root,"stage"), out=join(root,"out")
    stageMemoryTarball(bytes,{sha256:sha256(bytes),source_commit:"5".repeat(40)},stage)
    materialiseArm(stage,out)
    const manifest=JSON.parse(readFileSync(join(out,".mem-arm.json")))
    assert.equal(manifest.archive_sha256,sha256(bytes)); assert.equal(manifest.source_commit,"5".repeat(40))
    assert.equal(readFileSync(join(out,"src/index.js"),"utf8"),'export default { id: "mem" }')
  } finally {rmSync(root,{recursive:true,force:true})}
})
test("wrong archive digest, traversal, symlinks, duplicate paths and project config fail before staging", () => {
  for (const [list, digest] of [[entries(),"a".repeat(64)],[[...entries(),["../escape","x"]]],[[...entries(),["src/link.js","","2"]]],[[...entries(),entries()[0]]],[[...entries(),["opencode.json","{}"]]]]) {
    const root=mkdtempSync(join(tmpdir(),"mem-tar-bad-"))
    try {const bytes=tar(list),out=join(root,"stage");assert.throws(()=>stageMemoryTarball(bytes,{sha256:digest??sha256(bytes),source_commit:"5".repeat(40)},out),/archive|tar|unsafe|duplicate|config/);assert.equal(existsSync(out),false)} finally {rmSync(root,{recursive:true,force:true})}
  }
})
