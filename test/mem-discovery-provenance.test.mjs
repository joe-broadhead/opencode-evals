// Static dependency audit + the actual CLI hash, in disposable isolated copies only.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,cpSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {dirname,join,relative,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const root=resolve(import.meta.dirname,'..')
const missingAtReview=[
  'packs/mem/cases.mjs',
  'src/run/guard/mem-targets.mjs',
  'src/run/guard/mem-discovery-shapes.mjs',
  'src/run/guard/mem-discovery-intents.mjs',
]
const read=file=>readFileSync(join(root,file),'utf8')
const sha=value=>createHash('sha256').update(value).digest('hex')
function hashFiles(){
  const cli=read('src/cli.mjs')
  const block=cli.slice(cli.indexOf('function graderHash()'),cli.indexOf('function writeLock('))
  const adapters=read('src/grade/adapters/index.mjs').split('export const ADAPTER_FILES = ')[1]
  assert.ok(adapters,'explicit adapter digest list is present')
  return new Set([...`${block}\n${adapters}`.matchAll(/["']([^"'\n]+\.(?:mjs|json))["']/g)].map(m=>m[1]))
}
function localClosure(file,closure=new Set()){
  if(closure.has(file))return closure
  closure.add(file)
  const source=read(file)
  // Read source bytes; never import/evaluate a dependency to discover its imports.
  for(const m of source.matchAll(/(?:from\s*|import\s*|import\s*\(\s*)["'](\.[^"']+)["']/g)){
    const next=relative(root,resolve(root,dirname(file),m[1]))
    assert.ok(!next.startsWith('../'),'local verdict dependencies stay in the harness')
    if(/\.(?:mjs|js|ts)$/.test(next))localClosure(next,closure)
  }
  return closure
}
test('the reviewed explicit digest list covers the complete local discovery verdict import closure',()=>{
  const hashed=hashFiles(),closure=localClosure('src/grade/adapters/mem-discovery.mjs')
  for(const file of missingAtReview)assert.ok(closure.has(file),`reviewed verdict dependency ${file}`)
  assert.deepEqual([...closure].filter(file=>!hashed.has(file)).sort(),[])
})
test('actual CLI grader hash changes for every omitted dependency in an isolated copy and restores exactly',()=>{
  const scratch=mkdtempSync(join(tmpdir(),'s2s4-digest-'))
  const copy=join(scratch,'harness'),originals=new Map(missingAtReview.map(file=>[file,read(file)]))
  try{
    mkdirSync(copy)
    for(const dir of ['bin','src','packs','cases','worlds','cost','docker','scripts'])cpSync(join(root,dir),join(copy,dir),{recursive:true})
    cpSync(join(root,'package.json'),join(copy,'package.json'))
    const home=join(scratch,'home'),store=join(scratch,'store');mkdirSync(home);mkdirSync(store)
    const hash=()=>{
      execFileSync(process.execPath,['bin/evals','lock','--plugin','mem'],{cwd:copy,env:{PATH:process.env.PATH,HOME:home,TMPDIR:scratch,EVALS_STORE:store},timeout:15000,stdio:'pipe'})
      const digest=JSON.parse(readFileSync(join(copy,'cases/mem/evals.lock'),'utf8')).grader_sha256
      assert.match(digest,/^[a-f0-9]{64}$/)
      return digest
    }
    const baseline=hash(),proof=[]
    // Also guard the new immutable/canonical helper's verdict-changing source bytes.
    for(const file of [...missingAtReview,'packs/mem/discovery-plan.mjs']){
      const target=join(copy,file),before=readFileSync(target)
      let changed
      try{
        writeFileSync(target,Buffer.concat([before,Buffer.from('\n// isolated provenance perturbation; no runtime side effect\n')]))
        changed=hash()
      }finally{writeFileSync(target,before)}
      const restored=hash()
      proof.push({file,baseline,changed,restored,bytes_restored:sha(readFileSync(target))===sha(before)})
    }
    console.log(JSON.stringify({isolated_cli_digest_proof:proof}))
    for(const row of proof){
      assert.notEqual(row.changed,baseline,row.file)
      assert.equal(row.restored,baseline,row.file)
      assert.equal(row.bytes_restored,true,row.file)
    }
    for(const [file,before]of originals)assert.equal(read(file),before,`source never perturbed: ${file}`)
  }finally{rmSync(scratch,{recursive:true,force:true})}
})
