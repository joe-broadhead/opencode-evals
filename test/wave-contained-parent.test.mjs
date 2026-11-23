import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, renameSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main } from "../scripts/run-mem-wave.mjs"
import { WAVE_MODEL } from "../src/run/wave-manifest.mjs"
import { containedFixture, drive } from "./support/wave-contained-parent.mjs"
import { processAdapter } from "../src/run/wave-process.mjs"
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "wave-contained-parent-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const wave = { id: "owned", harness_sha: "a".repeat(40), control: join(root,"control"), store: join(root,"store"), docker_config: join(root,"docker"),
    model: WAVE_MODEL, trial_timeout_s: 5, caps: { path: join(root,"caps.json") }, runtime: { docker: { path: "/pinned/docker" }, image: `sha256:${"b".repeat(64)}` },
    trials: ["first","second"].map(id => ({ id, case: "core-a", arm: "baseline", condition: "direct" })) }
  mkdirSync(wave.docker_config)
  writeFileSync(wave.caps.path,JSON.stringify({estimate_run_usd:{[WAVE_MODEL]:{wide:0.1}}}))
  const file=join(root,"manifest.json");writeFileSync(file,JSON.stringify(wave))
  const options={env:{OPENCODE_API_KEY:"synthetic-test-key"},identity:()=>({}),qualify:()=>({execution_qualified:true,plan:{cases:[{id:"core-a",set:"core",tier:"wide"}]}}),
    adapter:{supervisionAvailable:true,worker:()=>assert.fail("host worker forbidden"),trial:()=>assert.fail("host CLI forbidden"),signal:()=>assert.fail("host signal forbidden")}}
  return {root,wave,file,options}
}

test("actual parent entry uses the approved snapshot seam, never the host trial fallback", async t => {
  const f=setup(t);let snapshots=0
  f.options.adapter.owned={snapshot:()=>{snapshots++;throw new Error("approved artifacts unavailable")},spawn:()=>assert.fail("no artifacts, no Docker client")}
  const report=await main(["--manifest",f.file],f.options)
  assert.equal(snapshots,1)
  assert.equal(report.complete,false)
  assert.equal(report.trials.every(t=>t.status==="unrun"),true)
  assert.equal(existsSync(join(f.wave.control,"worker.json")),false)
  assert.equal(readFileSync(join(f.wave.control,"manifest.json"),"utf8"),readFileSync(f.file,"utf8"))
})

test("actual parent contains one physical trial, journals before launch, and retains provisional cost without a successor", async t => {
  const f=setup(t),x=containedFixture(f)
  f.options.adapter.owned=x.owned;f.options.clock=x.c
  const report=await drive(main(["--manifest",f.file],f.options),x.c)
  assert.equal(x.descriptors.length,1)
  const d=x.descriptors[0]
  assert.equal(d.binding.trial_id,"first")
  assert.equal(d.options.model,WAVE_MODEL)
  assert.equal(d.options.iteration,"owned-first")
  assert.equal(d.options.isolation,"owned-container")
  assert.equal(d.options.harnessRetries,0)
  assert.equal(d.options.processGroup,"inherited")
  assert.equal(d.options.casesDir,"/inputs/cases")
  assert.equal(x.resources.size,0)
  assert.equal(x.journal().verified_gone,true)
  assert.equal(x.finalReads.length>0,true)
  assert.equal(report.complete,false)
  assert.equal(report.successor_allowed,false)
  assert.equal(report.trials[1].status,"unrun")
  assert.equal(report.trials[0].containment.accounting.known_billed_usd,0.25)
  assert.equal(report.trials[0].containment.accounting.complete,false)
  assert.equal(existsSync(join(f.wave.control,"wave.lock")),true,"unknown settlement retains lease")
  assert.equal(existsSync(join(f.wave.control,"worker.json")),false)
  assert.equal(x.c.pending(),0)
})

test("snapshot approval cannot outlive a changed manifest at actual dispatch", async t => {
  const f=setup(t),x=containedFixture(f),snapshot=x.owned.snapshot
  x.owned.snapshot=request=>{const result=snapshot(request);writeFileSync(f.file,"{}");return result}
  f.options.adapter.owned=x.owned;f.options.clock=x.c
  const report=await drive(main(["--manifest",f.file],f.options),x.c)
  assert.equal(x.calls.length,0,"requalify frozen bytes after snapshot acquisition")
  assert.equal(report.trials[0].status,"unrun")
  assert.equal(existsSync(join(f.wave.control,"resources","first.started.json")),false)
})

test("the $10 admission is rechecked after an asynchronous approved snapshot", async t => {
  const f=setup(t),x=containedFixture(f),snapshot=x.owned.snapshot
  x.owned.snapshot=request=>{writeFileSync(f.wave.caps.path,JSON.stringify({estimate_run_usd:{[WAVE_MODEL]:{wide:11}}}));return snapshot(request)}
  f.options.adapter.owned=x.owned;f.options.clock=x.c
  const report=await drive(main(["--manifest",f.file],f.options),x.c)
  assert.equal(x.calls.length,0)
  assert.equal(report.stop_reason,"budget-admission")
})

test("production adapter has no native staging capability and ignores manifest or environment overrides", async t => {
  const f=setup(t)
  f.wave.execution_qualified=true;f.wave.owned={snapshot:"pretend",spawn:"pretend"};writeFileSync(f.file,JSON.stringify(f.wave))
  f.options.env.EVALS_OWNED_QUALIFIED="true"
  f.options.adapter=processAdapter({spawn:()=>assert.fail("unqualified native spawn forbidden")})
  const report=await main(["--manifest",f.file],f.options)
  assert.equal(report.complete,false)
  assert.equal(report.stop_reason,"qualification-failed")
  assert.equal(report.execution_qualified,false)
  assert.equal(report.successor_allowed,false)
  assert.equal(existsSync(join(f.wave.control,"wave.lock")),false)
})

test("parent channel loss is sticky at initial admission and after snapshot approval", async t => {
  for(const mode of ["initial","snapshot","rebound"]) {
    const f=setup(t),x=containedFixture(f),snapshot=x.owned.snapshot
    const descriptors=Object.fromEntries(["connected","send"].map(k=>[k,Object.getOwnPropertyDescriptor(process,k)]))
    const listeners=process.rawListeners("disconnect")
    process.connected=mode!=="initial";process.send=()=>assert.fail("parent does not dispatch host trial IPC")
    x.owned.snapshot=request=>{const s=snapshot(request);process.connected=false;process.emit("disconnect");if(mode==="rebound")process.connected=true;return s}
    f.options.adapter.owned=x.owned;f.options.clock=x.c
    try {
      const report=await drive(main(["--manifest",f.file],f.options),x.c)
      assert.equal(x.calls.length,0,mode)
      assert.equal(report.trials.every(t=>t.status==="unrun"),true)
      assert.deepEqual(process.rawListeners("disconnect"),listeners)
    } finally {for(const [k,d]of Object.entries(descriptors))if(d)Object.defineProperty(process,k,d);else delete process[k]}
  }
})

test("replacement of the original parent scope never grants a journal or successor authority", async t => {
  for(const mode of ["snapshot","creation"]) {
    const f=setup(t),directory=join(f.wave.control,"resources"),retained=directory+"-original"
    let replaced=false
    const replace=()=>{renameSync(directory,retained);mkdirSync(directory);writeFileSync(join(directory,"foreign"),"untouched");replaced=true}
    const x=containedFixture(f,{journalDirectory:()=>replaced?retained:directory,reply:({a,r,settle})=>{if(mode==="creation"&&!replaced&&a[0]==="network"&&a[1]==="create")replace();settle(r)}})
    const snapshot=x.owned.snapshot
    if(mode==="snapshot")x.owned.snapshot=request=>{const s=snapshot(request);replace();return s}
    f.options.adapter.owned=x.owned;f.options.clock=x.c
    const report=await drive(main(["--manifest",f.file],f.options),x.c)
    assert.equal(report.supervision.cleanup_verified,false)
    assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
    assert.equal(readFileSync(join(directory,"foreign"),"utf8"),"untouched")
    assert.equal(existsSync(join(directory,"first.json")),false)
    assert.equal(x.descriptors.length,0)
    assert.equal(x.finalReads.length,0)
    assert.equal(x.resources.size,0,"only already accepted exact IDs are reclaimed")
  }
})

test("unknown creation, daemon absence and client closure retain the lease and prohibit final reads", async t => {
  for(const mode of ["partial","lost","daemon","close"]) {
    const f=setup(t);let held
    const x=containedFixture(f,{reply:({a,r,settle,child})=>{
      if(a[0]==="create"&&!held&&mode!=="daemon") {
        held={child,settle}
        if(mode==="partial")return settle({...r,stdout:r.stdout.slice(0,20)})
        if(mode==="lost")return settle({...r,code:1,stdout:""})
        settle(r,false);child.stderr.emit("data",Buffer.alloc(1048577));return
      }
      if(mode==="daemon"&&r.code===1)return settle({...r,stderr:"daemon unavailable"})
      settle(r)
    }})
    f.options.adapter.owned=x.owned;f.options.clock=x.c
    x.owned.nativeSnapshot=binding=>({binding,outcome:"interrupted"})
    const report=await drive(main(["--manifest",f.file],f.options),x.c)
    const result=report.trials[0].containment
    assert.equal(report.supervision.cleanup_verified,false,mode)
    assert.equal(result.native,"interrupted",mode)
    assert.equal(report.successor_allowed,false)
    assert.equal(x.finalReads.length,0,mode)
    assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
    assert.equal(x.calls.filter(a=>a[0]==="exec").length,mode==="daemon"?1:0)
    if(mode==="close") {assert.equal(x.resources.size,0,"full successful ID still grants exact removal");held.settle({code:0})}
    if(["partial","lost"].includes(mode))assert.equal(x.resources.size,1,"unknown ID is not adopted by name")
  }
})

test("independent parent deadlines and disk failure bound the actual contained execution", async t => {
  for(const mode of ["snapshot-timeout","execution-timeout","disk","cancel"]) {
    const f=setup(t),x=containedFixture(f,{reply:({a,r,settle})=>{
      if(mode==="execution-timeout"&&a[0]==="exec")return
      if(mode==="cancel"&&a[0]==="create")process.emit("SIGTERM") // synthetic EventEmitter delivery, no OS signal
      settle(r)
    }})
    if(mode==="snapshot-timeout")x.owned.snapshot=()=>new Promise(()=>{})
    if(mode==="disk")x.owned.measure=()=>false
    f.options.adapter.owned=x.owned;f.options.clock=x.c
    const report=await drive(main(["--manifest",f.file],f.options),x.c)
    assert.equal(report.complete,false)
    assert.equal(report.trials[1].status,"unrun")
    assert.equal(x.c.now()<=125000,true,mode)
    assert.equal(x.resources.size,0,mode)
    if(mode!=="execution-timeout")assert.equal(x.descriptors.length,0)
    assert.equal(x.c.pending(),0,mode)
  }
})

test("late creation output cannot update the closed parent journal or start another trial", async t => {
  const f=setup(t);let late
  const x=containedFixture(f,{reply:({a,r,settle})=>{if(a[0]==="create"&&!late){late=()=>settle(r);return}settle(r)}})
  f.options.adapter.owned=x.owned;f.options.clock=x.c
  const report=await drive(main(["--manifest",f.file],f.options),x.c)
  const before=readFileSync(join(f.wave.control,"resources","first.json"),"utf8")
  assert.equal(report.trials[0].containment.creation_unknown,true)
  assert.equal(report.supervision.cleanup_verified,false)
  late();for(let i=0;i<300;i++)await Promise.resolve()
  assert.equal(readFileSync(join(f.wave.control,"resources","first.json"),"utf8"),before)
  assert.equal(x.descriptors.length,0)
  assert.equal(x.resources.size,1,"unknown late creation cannot be adopted")
  assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
  assert.equal(x.c.pending(),0)
})

test("journal replacement after creation preserves the foreign file and retains uncertainty", async t => {
  const f=setup(t);let replaced=false
  const file=join(f.wave.control,"resources","first.json")
  const x=containedFixture(f,{reply:({a,r,settle})=>{
    if(!replaced&&a[0]==="network"&&a[1]==="create") {renameSync(file,file+"-original");writeFileSync(file,"foreign-data");replaced=true}
    settle(r)
  }})
  f.options.adapter.owned=x.owned;f.options.clock=x.c
  const report=await drive(main(["--manifest",f.file],f.options),x.c)
  assert.equal(readFileSync(file,"utf8"),"foreign-data")
  assert.equal(report.supervision.cleanup_verified,false)
  assert.equal(x.resources.size,0)
  assert.equal(x.finalReads.length,0)
  assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
})

test("partial postmortem evidence retains raw billing and a bound native negative without acceptance", async t => {
  const f=setup(t),x=containedFixture(f,{reply:({a,r,settle,work})=>{
    if(a[0]==="exec") {const file=join(work,"provisional.json"),receipt=JSON.parse(readFileSync(file));receipt.capture="batch/runs/core-a.t1/tmp/mem-fixture/capture.json";writeFileSync(file,JSON.stringify(receipt))}
    settle(r)
  }})
  x.owned.nativeSnapshot=binding=>({binding,outcome:"failed"})
  f.options.adapter.owned=x.owned;f.options.clock=x.c
  const report=await drive(main(["--manifest",f.file],f.options),x.c),result=report.trials[0].containment
  assert.equal(result.native,"failed")
  assert.equal(result.evidence,"unknown")
  assert.equal(result.accounting.known_billed_usd,0.25)
  assert.equal(result.accounting.billed_usd,null)
  assert.equal(result.complete,false)
  assert.equal(report.successor_allowed,false)
  assert.equal(existsSync(join(f.wave.store,"ledger","runs.jsonl")),false,"P-F aggregate import remains absent")
})

test("a lost parent channel after the first dispatch cannot admit a successor even after rebound", async t => {
  const f=setup(t),descriptors=Object.fromEntries(["connected","send"].map(k=>[k,Object.getOwnPropertyDescriptor(process,k)]))
  process.connected=true;process.send=()=>assert.fail("no host executor IPC")
  const x=containedFixture(f,{reply:({a,r,settle})=>{settle(r);if(a[0]==="exec"){process.connected=false;process.emit("disconnect");process.connected=true}}})
  f.options.adapter.owned=x.owned;f.options.clock=x.c
  try {
    const report=await drive(main(["--manifest",f.file],f.options),x.c)
    assert.equal(x.descriptors.length,1)
    assert.equal(report.trials[1].status,"unrun")
    assert.equal(report.complete,false)
    assert.equal(x.resources.size,0)
  }finally{for(const [k,d]of Object.entries(descriptors))if(d)Object.defineProperty(process,k,d);else delete process[k]}
})

test("snapshot bindings and staged hashes are checked before any resource creation", async t => {
  for(const mode of ["manifest_sha256","harness_sha","trial_id","inputs","binaries","occupied-work"]) {
    const f=setup(t),x=containedFixture(f),snapshot=x.owned.snapshot
    x.owned.snapshot=request=>{
      const result=snapshot(request)
      if(["manifest_sha256","harness_sha","trial_id"].includes(mode))result[mode]="wrong"
      if(mode==="inputs")writeFileSync(join(result.inputs,"cases","core-a.json"),"changed")
      if(mode==="binaries")writeFileSync(join(result.binaries,"node"),"not pinned")
      if(mode==="occupied-work")writeFileSync(join(result.work,"foreign"),"untouched")
      return result
    }
    f.options.adapter.owned=x.owned;f.options.clock=x.c
    const report=await drive(main(["--manifest",f.file],f.options),x.c)
    assert.equal(x.calls.length,0,mode)
    assert.equal(report.complete,false)
    assert.equal(report.execution_qualified,false)
    assert.equal(report.successor_allowed,false)
    assert.equal(x.finalReads.length,0)
  }
})

test("the retained work root identity refuses replacement data at parent finalization", async t => {
  const f=setup(t),x=containedFixture(f,{reply:({a,r,settle,work})=>{
    if(a[0]==="exec"){renameSync(work,work+"-original");mkdirSync(work);writeFileSync(join(work,"provisional.json"),"foreign")}
    settle(r)
  }})
  f.options.adapter.owned=x.owned;f.options.clock=x.c
  const report=await drive(main(["--manifest",f.file],f.options),x.c)
  assert.equal(x.resources.size,0)
  assert.equal(x.finalReads.length,0)
  assert.equal(report.trials[0].containment.evidence,"unknown")
  assert.equal(readFileSync(join(x.work,"provisional.json"),"utf8"),"foreign")
  assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
})

test("deadline expiration denies journal updates and late snapshot admission", async t => {
  for(const mode of ["create","snapshot"]) {
    const f=setup(t);let before,late
    const file=join(f.wave.control,"resources","first.json")
    const x=containedFixture(f,{reply:({a,r,settle,c})=>{
      if(a[0]==="network"&&a[1]==="create"){before=readFileSync(file,"utf8");c.advance(3600000)}
      settle(r)
    }})
    const snapshot=x.owned.snapshot
    if(mode==="snapshot")x.owned.snapshot=request=>new Promise(resolve=>{late=()=>resolve(snapshot(request))})
    f.options.adapter.owned=x.owned;f.options.clock=x.c
    const report=await drive(main(["--manifest",f.file],f.options),x.c)
    if(late){late();for(let i=0;i<300;i++)await Promise.resolve()}
    assert.equal(report.complete,false)
    assert.equal(x.descriptors.length,0)
    assert.equal(x.finalReads.length,0)
    if(mode==="create") {
      assert.equal(readFileSync(file,"utf8"),before)
      assert.equal(report.supervision.cleanup_verified,false)
      assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
    } else {
      assert.equal(x.calls.length,0)
      assert.equal(existsSync(join(f.wave.control,"resources","first.started.json")),false)
    }
    assert.equal(x.c.pending(),0)
  }
})

test("deleting a parent journal cannot create a fresh authority for the same trial", async t => {
  const f=setup(t);let removed=false
  const file=join(f.wave.control,"resources","first.json")
  const x=containedFixture(f,{reply:({a,r,settle})=>{
    if(!removed&&a[0]==="network"&&a[1]==="create"){rmSync(file);removed=true}
    settle(r)
  }})
  f.options.adapter.owned=x.owned;f.options.clock=x.c
  const report=await drive(main(["--manifest",f.file],f.options),x.c)
  assert.equal(x.descriptors.length,0)
  assert.equal(existsSync(file),false)
  assert.equal(x.resources.size,0)
  assert.equal(report.supervision.cleanup_verified,false)
  assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
})

test("suspension during journal synchronization cannot commit past the trial cleanup deadline", async t => {
  const f=setup(t),x=containedFixture(f),monotonic=x.c.monotonic
  const directory=join(f.wave.control,"resources")
  let suspended=false
  x.c.monotonic=()=>{
    if(!suspended&&existsSync(directory)&&readdirSync(directory).some(name=>name.startsWith(".first.json."))){suspended=true;x.c.advance(125001)}
    return monotonic()
  }
  f.options.adapter.owned=x.owned;f.options.clock=x.c
  const report=await drive(main(["--manifest",f.file],f.options),x.c)
  assert.equal(suspended,true)
  assert.equal(x.calls.length,0)
  assert.equal(existsSync(join(directory,"first.json")),false,"expired temporary journal never becomes authoritative")
  assert.equal(report.supervision.cleanup_verified,false)
  assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
  assert.equal(readdirSync(directory).some(name=>name.endsWith(".tmp")),false)
})

test("inner exit zero and an injected positive native claim never qualify parent acceptance", async t => {
  const f=setup(t),x=containedFixture(f,{reply:({a,r,settle})=>settle(a[0]==="exec"?{...r,code:0}:r)})
  x.owned.nativeSnapshot=binding=>({binding,outcome:"success",logicalProof:true,accepted:false})
  f.options.adapter.owned=x.owned;f.options.clock=x.c
  const report=await drive(main(["--manifest",f.file],f.options),x.c)
  assert.equal(report.trials[0].containment.worker_exit,0)
  assert.equal(report.trials[0].containment.native,"unknown")
  assert.equal(report.complete,false)
  assert.equal(report.execution_qualified,false)
  assert.equal(report.successor_allowed,false)
  assert.equal(report.trials[1].status,"unrun")
  assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
})

test("parent exports local reason codes, never callback diagnostics, in memory or on disk", async t => {
  for (const diagnostic of ["synthetic-test-key", "unlisted-private-diagnostic"]) {
    const f=setup(t),x=containedFixture(f),spawn=x.owned.spawn
    let creates=0
    x.owned.spawn=(binary,args,options)=>{
      if(args[2]==="network"&&args[3]==="create"&&++creates===2)throw Error(diagnostic)
      return spawn(binary,args,options)
    }
    f.options.adapter.owned=x.owned;f.options.clock=x.c
    const report=await drive(main(["--manifest",f.file],f.options),x.c)
    for(const value of [JSON.stringify(report),...['progress.json','report.json'].map(name=>readFileSync(join(f.wave.control,name),'utf8'))])assert.equal(value.includes(diagnostic),false)
    assert.equal(report.trials[0].containment.reason,"contained-operation-unavailable")
    assert.equal(report.trials[0].containment.native,"unknown")
    assert.equal(x.resources.size,0)
    assert.equal(report.supervision.cleanup_verified,false)
    assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
  }
})

test("unavailable or asynchronous native snapshots cannot suppress fixed billing recovery", async t => {
  for(const mode of ["throw","reject","thenable","async-negative","negative-then-throw"]) {
    const f=setup(t),x=containedFixture(f);let calls=0
    x.owned.nativeSnapshot=binding=>{
      calls++
      if(mode==="reject")return Promise.reject(Error("synthetic-test-key"))
      if(mode==="thenable")return {then(_resolve,reject){reject(Error("unlisted-native-diagnostic"))}}
      if(mode==="async-negative")return Promise.resolve({binding,outcome:"failed"})
      if(mode==="negative-then-throw"&&calls===1)return {binding,outcome:"interrupted"}
      throw Error("synthetic-test-key")
    }
    f.options.adapter.owned=x.owned;f.options.clock=x.c
    const report=await drive(main(["--manifest",f.file],f.options),x.c),result=report.trials[0].containment
    await new Promise(setImmediate) // Strict rejection handling must survive the next event-loop turn.
    assert.equal(result.accounting.known_billed_usd,0.25,mode)
    assert.equal(result.accounting.complete,false)
    assert.equal(result.native,mode==="negative-then-throw"?"interrupted":"unknown")
    assert.equal(result.cleanup_verified,true)
    assert.ok(x.finalReads.length>=2)
    assert.equal(JSON.stringify(report).includes("synthetic-test-key"),false)
    assert.equal(report.successor_allowed,false)
    assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
  }
})

test("late aggregate or progress errors retain recovered in-memory trial facts", async t => {
  for(const mode of ["ledger","progress-write","report-write"]) {
    const f=setup(t),x=containedFixture(f,{reply:({a,r,settle})=>{
      if(a[0]==="exec"){mkdirSync(join(f.wave.store,"ledger"),{recursive:true});writeFileSync(join(f.wave.store,"ledger","runs.jsonl"),"malformed-aggregate\n")}
      settle(r)
    }})
    x.owned.nativeSnapshot=binding=>({binding,outcome:"interrupted"})
    f.options.adapter.owned=x.owned;f.options.clock=x.c
    const original=fs.writeFileSync;let faulted=false
    fs.writeFileSync=(path,data,...args)=>{
      if(mode==="report-write"&&String(path).includes("report.json.")&&String(data).includes('"containment"'))throw Error("private-write-diagnostic")
      if(mode==="progress-write"&&!faulted&&String(path).includes("progress.json.")&&String(data).includes('"containment"')){faulted=true;throw Error("private-write-diagnostic")}
      return original(path,data,...args)
    }
    syncBuiltinESMExports()
    let report
    try {
      const pending=drive(main(["--manifest",f.file],f.options),x.c)
      if(mode==="report-write")await assert.rejects(pending,/private-write-diagnostic/)
      else report=await pending
    }
    finally {fs.writeFileSync=original;syncBuiltinESMExports()}
    if(mode==="report-write") {
      assert.equal(x.resources.size,0)
      assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
      assert.equal(JSON.parse(readFileSync(join(f.wave.control,"report.json"))).trials[0].containment,undefined)
      continue // Failed final persistence is an error, not a successful report claim.
    }
    for(const value of [report,JSON.parse(readFileSync(join(f.wave.control,"report.json")))]) {
      assert.equal(value.trials[0].containment?.accounting.known_billed_usd,0.25,mode)
      assert.equal(value.trials[0].containment.native,"interrupted")
      assert.equal(value.trials[0].containment.cleanup_verified,true)
      assert.deepEqual(value.cost,{unresolved:true})
      assert.equal(value.successor_allowed,false)
      assert.equal(JSON.stringify(value).includes("private-write-diagnostic"),false)
    }
    if(mode==="ledger")assert.equal(report.supervision.cleanup_verified,true)
    else {assert.equal(faulted,true);assert.equal(JSON.parse(readFileSync(join(f.wave.control,"progress.json"))).trials[0].status,"running")}
    assert.equal(readFileSync(join(f.wave.store,"ledger","runs.jsonl"),"utf8"),"malformed-aggregate\n")
    assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
  }
})

test("journal commit rechecks the previous target after fsync and still cleans accepted IDs", async t => {
  for(const phase of ["pending","accepted"]) {
    const f=setup(t),x=containedFixture(f),file=join(f.wave.control,"resources","first.json"),original=fs.fsyncSync
    let replaced=false
    fs.fsyncSync=fd=>{
      original(fd)
      if(!replaced&&fs.fstatSync(fd).isFile()&&existsSync(file)&&JSON.parse(readFileSync(file)).pending.length===(phase==="pending"?0:1)) {
        replaced=true;renameSync(file,file+"-original");writeFileSync(file,"foreign-journal")
      }
    }
    syncBuiltinESMExports()
    f.options.adapter.owned=x.owned;f.options.clock=x.c
    let report
    try {report=await drive(main(["--manifest",f.file],f.options),x.c)}
    finally {fs.fsyncSync=original;syncBuiltinESMExports()}
    assert.equal(replaced,true)
    assert.equal(readFileSync(file,"utf8"),"foreign-journal")
    assert.equal(x.descriptors.length,0)
    assert.equal(x.resources.size,0)
    assert.equal(x.calls.filter(a=>a[0]==="network"&&a[1]==="rm").length,phase==="accepted"?1:0)
    assert.equal(report.supervision.cleanup_verified,false)
    assert.equal(existsSync(join(f.wave.control,"wave.lock")),true)
    assert.equal(readdirSync(join(f.wave.control,"resources")).some(name=>name.endsWith(".tmp")),false)
  }
})
