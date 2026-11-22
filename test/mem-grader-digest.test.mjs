// Execute only the actual pure graderHash function, never the CLI's host/runner imports.
import {test} from "node:test"
import assert from "node:assert/strict"
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,appendFileSync,rmSync,existsSync} from "node:fs"
import {join,dirname,resolve,relative} from "node:path"
import {tmpdir} from "node:os"
import {ADAPTER_FILES} from "../src/grade/adapters/index.mjs"
import {sha256,digestOf} from "../src/util/canonical.mjs"
const root=resolve(import.meta.dirname,"..")
test("M7 executable adapter dependency inventory includes every transitive local module",()=>{
  const seen=new Set(),visit=file=>{
    if(seen.has(file))return;seen.add(file)
    assert.ok(ADAPTER_FILES.includes(file),`unhashed adapter dependency: ${file}`)
    for(const m of readFileSync(join(root,file),"utf8").matchAll(/(?:import|export)\s[^\n]*?from\s*["'](\.[^"']+)["']/g))visit(relative(root,resolve(root,dirname(file),m[1])))
  }
  visit("src/grade/adapters/index.mjs");visit("src/grade/adapters/mem-core.mjs");visit("src/grade/adapters/mem-discovery.mjs");visit("src/run/mem-intent-plan.mjs")
})
test("M7 actual graderHash changes when only the durable oracle changes in an owned temporary copy",()=>{
  const source=readFileSync(join(root,"src/cli.mjs"),"utf8")
  const fn=source.match(/function graderHash\(\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(fn,"actual CLI hash seam remains available")
  const files=[...fn.matchAll(/"([^"]+\.mjs)"/g)].map(m=>m[1])
  const copy=mkdtempSync(join(tmpdir(),"mem-core-digest-"))
  try {
    for(const file of new Set([...files,...ADAPTER_FILES,"src/grade/adapters/mem-durable.mjs"])) {
      mkdirSync(dirname(join(copy,file)),{recursive:true});copyFileSync(join(root,file),join(copy,file))
    }
    const actualHash=Function("ADAPTER_FILES","path","read","sha256","digestOf",`return (${fn})()`)
    const hash=()=>actualHash(ADAPTER_FILES,file=>join(copy,file),file=>readFileSync(file,"utf8"),sha256,digestOf)
    const before=hash()
    appendFileSync(join(copy,"src/grade/adapters/mem-durable.mjs"),"\n// Owned digest-sensitivity probe only.\n")
    assert.notEqual(hash(),before)
  }finally{rmSync(copy,{recursive:true,force:true});assert.equal(existsSync(copy),false)}
})
