// Execute only the actual pure graderHash function, never the CLI's host/runner imports.
import {test} from "node:test"
import assert from "node:assert/strict"
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,appendFileSync,writeFileSync,rmSync,existsSync} from "node:fs"
import {join,dirname,resolve,relative} from "node:path"
import {tmpdir} from "node:os"
import {ADAPTER_FILES} from "../src/grade/adapters/index.mjs"
import {sha256,digestOf} from "../src/util/canonical.mjs"
const root=resolve(import.meta.dirname,"..")
const source=readFileSync(join(root,"src/cli.mjs"),"utf8")
const hashSource=source.match(/function graderHash\(\) \{[\s\S]*?\n\}/)?.[0]
assert.ok(hashSource,"actual CLI hash seam remains available")
const hashFunction=code=>Function("ADAPTER_FILES","path","read","sha256","digestOf",`return (${code})()`)
const actualHash=hashFunction(hashSource)
function hashAt(directory=root,hash=actualHash){
  const files=[]
  const digest=hash(ADAPTER_FILES,file=>file,file=>{
    files.push(file)
    return readFileSync(join(directory,file),"utf8")
  },sha256,digestOf)
  return {files,digest}
}

// gradeAll is the CLI's recording loader -> projector/adapter -> runView -> gradeCase seam.
// Derive its imported callees, not the CLI's unrelated run/auth/container import graph.
// The CLI itself remains a hashed entrypoint artifact, including its local loader helpers.
function consumerClosure(){
  const loader=source.match(/function gradeAll\([^\n]*\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(loader,"actual grade loader seam remains available")
  const roots=[]
  for(const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](\.[^"']+)["']/g)){
    const names=match[1].split(",").map(s=>s.trim().split(/\s+as\s+/).at(-1))
    if(names.some(name=>new RegExp(`\\b${name}\\s*\\(`).test(loader)))roots.push(relative(root,resolve(root,"src",match[2])))
  }
  assert.ok(roots.includes("src/grade/grade.mjs"),"loader still calls the verdict seam")
  assert.ok(roots.includes("src/grade/adapters/mem-recording.mjs"),"loader still calls the private projector")
  // Preserve the reviewed continuation/intent proof seams as well as the loader closure.
  roots.push("src/run/mem-turns.mjs","src/run/mem-intent-plan.mjs","src/run/guard/mem-call-context.mjs")
  const seen=new Set(),visit=file=>{
    if(seen.has(file))return;seen.add(file)
    assert.ok(!file.startsWith("../"),"consumer dependency stays in the harness")
    for(const m of readFileSync(join(root,file),"utf8").matchAll(/(?:from\s*|import\s*|import\s*\(\s*)["'](\.[^"']+)["']/g))visit(relative(root,resolve(root,dirname(file),m[1])))
  }
  roots.forEach(visit)
  return [...seen].sort()
}
const closure=consumerClosure()
const assertCovered=files=>{
  for(const file of closure)assert.ok(files.includes(file),`unhashed consumed grader dependency: ${file}`)
}
test("M7 actual common plus adapter inventory covers the transitive grading consumer closure",()=>{
  const {files}=hashAt()
  assert.equal(new Set(files).size,files.length,"the actual hash inventory has no duplicate inputs")
  assert.ok(files.includes("src/cli.mjs"),"the loader/entrypoint artifact is hashed")
  assertCovered(files)
})
function withHashCopy(run){
  const {files}=hashAt()
  const copy=mkdtempSync(join(tmpdir(),"mem-core-digest-"))
  try {
    for(const file of files) {
      mkdirSync(dirname(join(copy,file)),{recursive:true});copyFileSync(join(root,file),join(copy,file))
    }
    run(copy,files)
  }finally{rmSync(copy,{recursive:true,force:true});assert.equal(existsSync(copy),false)}
}
test("M7 actual graderHash changes for every input, including common analyse and adapter durable/recording",()=>{
  withHashCopy((copy,files)=>{
    const baseline=hashAt().digest
    assert.equal(hashAt(copy).digest,baseline)
    for(const file of files){
      const target=join(copy,file),original=readFileSync(target)
      try{
        appendFileSync(target,"\n/* Owned digest-sensitivity probe only; never executed. */\n")
        assert.notEqual(hashAt(copy).digest,baseline,file)
      }finally{writeFileSync(target,original)}
      assert.equal(hashAt(copy).digest,baseline,`restored ${file}`)
      assert.deepEqual(readFileSync(join(root,file)),original,`source untouched: ${file}`)
    }
    console.log(JSON.stringify({m7_inventory:files,consumer_closure:closure,baseline,sensitivity_checks:files.length}))
  })
})
test("M7 negative control rejects each genuinely omitted consumer even though its bytes no longer affect the hash",()=>{
  withHashCopy((copy)=>{
    assert.equal(hashSource.split("const digests = {}").length,2,"mutation seam is unique")
    for(const file of closure){
      // Mutate only the extracted function in memory. The CLI and inventory on disk stay intact.
      const omittedHash=hashFunction(hashSource.replace("const digests = {}",`files.splice(files.indexOf(${JSON.stringify(file)}),1)\n  const digests = {}`))
      const omitted=hashAt(copy,omittedHash)
      assert.ok(!omitted.files.includes(file))
      assert.throws(()=>assertCovered(omitted.files),{message:`unhashed consumed grader dependency: ${file}`})
      const target=join(copy,file),original=readFileSync(target)
      try{
        appendFileSync(target,"\n/* Omitted dependency: hash must be insensitive, closure must reject. */\n")
        assert.equal(hashAt(copy,omittedHash).digest,omitted.digest,file)
      }finally{writeFileSync(target,original)}
    }
    console.log(JSON.stringify({m7_omission_controls:closure.length,all_rejected:true}))
  })
})
