import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { Writable } from "node:stream"
import { createOwnedDockerClient } from "../src/run/owned-docker-client.mjs"
import { createOwnedDockerProcess } from "../src/run/owned-docker-process.mjs"
import { containTrial } from "../src/run/owned-containment.mjs"
import { creationID } from "../src/run/container-receipt.mjs"

const context = "colima-mem-evals-20261122", binary = "/pinned/docker", config = "/parent/docker"
const id = "a".repeat(64)
const plan = () => ({context, dockerConfig:config, binding:{invocation_id:"11111111-1111-4111-8111-111111111111",manifest_sha256:"b".repeat(64),trial_id:"case-a"},
  image:`sha256:${"c".repeat(64)}`,imageEnv:["PATH=/usr/bin:/bin"],user:"1000:1000",control:"/parent/control",store:"/parent/store",work:"/staged/work",inputs:"/staged/inputs",binaries:"/staged/bin",
  inputs_sha256:"d".repeat(64),binaries_sha256:"e".repeat(64),allow:["opencode.ai"],credentialNames:["OPENCODE_API_KEY"],timeoutMs:1000,cleanupMs:1000,operationMs:100,outputBytes:4096,
  descriptor:{options:{plugin:"mem",iteration:"trial-a",model:"opencode/deepseek-v4.1-flash#low",auth:"env:OPENCODE_API_KEY",cases:"case-a",casesDir:"/inputs/cases",set:"set-a",trials:1,parallel:1,arm:"/inputs/arm",world:"/inputs/harness/worlds/mem/index.mjs",host:"2.2.6",timeout:1,stale:"refuse",tools:"locked",isolation:"owned-container",harnessRetries:0,processGroup:"inherited",condition:"direct"}}})
function fixture(options={}, onSpawn=()=>{}) {
  let now=0,next=0
  const timers=new Map(),calls=[],children=[],reads=[]
  const clock={now:()=>now,set(fn,ms){const key=++next;timers.set(key,{fn,at:now+ms});return key},clear:key=>timers.delete(key),tick(){const [key,t]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(key);now=t.at;t.fn()}}
  const spawn=(bin,args,opts)=>{
    const c=new EventEmitter();c.pid=200+children.length;c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.writes=[];c.signals=[]
    c.stdin.writableFinished=false
    c.stdin.end=(value,done)=>{c.writes.push(value);c.stdin.writableFinished=true;c.stdin.emit("finish");done?.();return c.stdin}
    c.kill=signal=>{c.signals.push(signal);return true}
    calls.push({bin,args,opts});children.push(c);onSpawn(c,args);return c
  }
  const readIdentity=child=>{reads.push(child);return {pid:child.pid,start:"start-a"}}
  const owner={binary,config,context,plan:plan(),credentialValues:{OPENCODE_API_KEY:"synthetic-secret"}}
  const transport=createOwnedDockerProcess(owner, {spawn,readIdentity,...options})
  const client=createOwnedDockerClient({binary,config,context,credentialValues:{OPENCODE_API_KEY:"synthetic-secret"}},{spawn:transport.spawn,clock,graceMs:10})
  return {transport,client,clock,timers,calls,children,reads,owner}
}
const inspect = ["--context",context,"inspect",id]
function execRequest() {
  const p=plan(),env={PATH:"/opt/evals/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",HOME:"/work/home",TMPDIR:"/work/tmp",EVALS_TMP:"/work/tmp",EVALS_STORE:"/work/store",XDG_CONFIG_HOME:"/work/home/.config",XDG_DATA_HOME:"/work/xdg-data",XDG_STATE_HOME:"/work/xdg-state",XDG_CACHE_HOME:"/work/home/.cache",EVALS_CAPS:"/inputs/caps.json",EVALS_MODELS_CATALOG:"/inputs/models.json",EVALS_MODEL_MAP:"/inputs/model-map.json",EVALS_NODE:"/opt/evals/bin/node",EVALS_OPENCODE_BIN:"/opt/evals/bin/opencode",OPENCODE_BIN_2_2_6:"/opt/evals/bin/opencode",OPENCODE_PASSWORD:"f".repeat(48),HTTPS_PROXY:"http://egress:3128",HTTP_PROXY:"http://egress:3128",NO_PROXY:"127.0.0.1,localhost"}
  return {args:["--context",context,"exec","-i","-w","/work",...[...Object.keys(env),"OPENCODE_API_KEY"].flatMap(n=>["-e",n]),id,"/opt/evals/bin/node","/inputs/harness/scripts/run-contained-trial.mjs"],options:{env,credentialNames:["OPENCODE_API_KEY"],input:JSON.stringify({...p.descriptor,schema:"oc-owned-launch/1",binding:p.binding,container_id:id,context,inputs_sha256:p.inputs_sha256,binaries_sha256:p.binaries_sha256}),timeoutMs:100,maxBytes:128}}
}
test("actual client uses only the pinned native transport and preserves direct child bytes and closure", async()=>{
  const f=fixture(),pending=f.client.run(inspect,{timeoutMs:100,maxBytes:128}),c=f.children[0]
  c.emit("spawn");c.stdout.emit("data",Buffer.from("[{"));c.stdout.emit("data",Buffer.from("}]\n"));c.emit("exit",0,null)
  assert.equal(f.client.closed(),false);c.emit("close",0,null)
  assert.deepEqual(f.calls,[{bin:binary,args:inspect,opts:{env:{PATH:"/usr/bin:/bin",DOCKER_CONFIG:config},shell:false,detached:false,stdio:["ignore","pipe","pipe"]}}])
  const result=await pending;assert.equal(result.stdout,"[{}]\n");assert.equal(result.code,0);assert.equal(result.closed,true)
  assert.equal(f.transport.qualified,false);assert.equal(f.client.closed(),true);assert.equal(f.timers.size,0)
})

test("actual containment command sequence is accepted, with only pinned options and exact exec environment", async()=>{
  let sequence=0
  const resources=new Set(),journals=[]
  const f=fixture({},(child,args)=>queueMicrotask(()=>{
    child.emit("spawn")
    const a=args.slice(2);let stdout="",stderr="",code=0
    if(a[0]==="create"||a[0]==="network"&&a[1]==="create"){stdout=String(++sequence).padStart(64,"0");resources.add(stdout)}
    else if(a[0]==="rm"||a[0]==="network"&&a[1]==="rm")resources.delete(a.at(-1))
    else if(a[0]==="inspect"||a[0]==="network"&&a[1]==="inspect"){
      if(resources.has(a.at(-1)))stdout="[{}]"
      else {code=1;stderr=`Error: No such object: ${a.at(-1)}\n`}
    } else if(a[0]==="logs")stdout='{"ev":"listening"}\n'
    child.stdout.emit("data",Buffer.from(stdout));child.stderr.emit("data",Buffer.from(stderr));child.emit("exit",code,null);child.emit("close",code,null)
  }))
  let done=false
  const p=plan(),pending=containTrial(p,{docker:f.client,clock:f.clock,journal:async s=>journals.push(s),validateInputs:async()=>({work:{dev:1,ino:2},inputs_sha256:p.inputs_sha256,binaries_sha256:p.binaries_sha256}),measure:async()=>true,inspectConfig:()=>true,finalize:async()=>({})})
  pending.finally(()=>done=true)
  for(let i=0;i<2000&&!done;i++)await Promise.resolve()
  assert.equal(done,true,"finite fake sequence, no wall timers")
  const result=await pending
  assert.equal(result.cleanup_verified,true);assert.equal(resources.size,0);assert.equal(sequence,4)
  assert.equal(result.complete,false);assert.equal(result.successor_allowed,false)
  const exec=f.calls.find(c=>c.args[2]==="exec"),child=f.children[f.calls.indexOf(exec)]
  assert.ok(exec);assert.deepEqual(exec.args.slice(-3),["0000000000000000000000000000000000000000000000000000000000000004","/opt/evals/bin/node","/inputs/harness/scripts/run-contained-trial.mjs"])
  assert.equal(exec.opts.env.OPENCODE_API_KEY,"synthetic-secret");assert.equal(exec.args.some(a=>a.includes("synthetic-secret")),false)
  assert.equal(exec.opts.env.HOME,"/work/home");assert.equal(exec.opts.env.DOCKER_CONFIG,config)
  assert.equal(child.writes.length,1);assert.equal(JSON.parse(child.writes[0]).container_id,exec.args.at(-3))
  assert.ok(f.calls.every(c=>c.args[0]==="--context"&&c.args[1]===context&&c.opts.shell===false&&c.opts.detached===false))
  for(const call of f.calls.filter(c=>c!==exec))assert.deepEqual(call.opts.env,{PATH:"/usr/bin:/bin",DOCKER_CONFIG:config})
  assert.equal(journals.at(-1).verified_gone,true);assert.equal(f.timers.size,0)
  // Corrupt each real producer's argv/env, not a copied positive grammar.
  const accepted=[...f.calls]
  for(const call of accepted) {
    for(const args of [[...call.args,"--unexpected"],["--context","foreign",...call.args.slice(2)]])assert.throws(()=>f.transport.spawn(binary,args,call.opts),/refused/)
    assert.throws(()=>f.transport.spawn(binary,call.args,{...call.opts,env:{...call.opts.env,DOCKER_HOST:"ssh://foreign"}}),/refused/)
    for(let i=0;i<call.args.length;i++) {
      if(/^[a-f0-9]{64}$/.test(call.args[i])||call.args[i].startsWith("type=bind,")) {
        const args=[...call.args];args[i]=args[i].startsWith("type=bind,")?"type=bind,src=/foreign,dst=/work":id.slice(0,12)
        assert.throws(()=>f.transport.spawn(binary,args,call.opts),/refused/)
      }
    }
  }
  assert.equal(f.calls.length,accepted.length,"all mutations rejected before native spawn")
})

test("stop signals only the original live child after an exact identity recheck; changed identity remains unknown", async()=>{
  let start="start-a",reads=0
  const f=fixture({readIdentity:child=>{reads++;return {pid:child.pid,start}}}),pending=f.client.run(inspect,{timeoutMs:100,maxBytes:128}),c=f.children[0]
  c.emit("spawn")
  const first=f.client.stopClients(),second=f.client.stopClients()
  assert.equal(reads,2,"capture plus immediate TERM recheck");assert.deepEqual(c.signals,["SIGTERM"])
  start="replacement";f.clock.tick()
  const result=await pending
  assert.deepEqual(c.signals,["SIGTERM"],"never KILL a replacement")
  assert.equal(result.closed,false);assert.equal(result.code,null);assert.equal(result.truncated,true)
  assert.equal(await first,false);assert.equal(await second,false)
  c.emit("exit",0,null);c.emit("close",0,null)
  assert.equal(f.client.closed(),true);assert.equal(result.closed,false)
})

test("Linux identity guard reads only the original child stat and never falls back after missing or malformed identity", async()=>{
  for(const replacement of ["999",null,"bad"]) {
    let start="123";const reads=[]
    const f=fixture({readIdentity:undefined,platform:"linux",readFile:(path,encoding)=>{
      reads.push([path,encoding]);if(start===null)throw Error("private-read-error")
      return `200 (docker child ) name) ${["S",...Array(18).fill("0"),start,"0"].join(" ")}\n`
    }}),pending=f.client.run(inspect,{timeoutMs:100,maxBytes:128}),c=f.children[0]
    c.emit("spawn");start=replacement
    const stopped=f.client.stopClients();f.clock.tick()
    assert.deepEqual(c.signals,[]);assert.equal((await pending).closed,false);assert.equal(await stopped,false)
    assert.deepEqual(reads,[["/proc/200/stat","utf8"],["/proc/200/stat","utf8"]])
    c.emit("exit",0,null);c.emit("close");assert.equal(f.client.closed(),true)
  }
  assert.throws(()=>fixture({readIdentity:undefined,platform:"darwin"}),/identity-unsupported/)
})

test("bounded bootstrap stdin waits for spawn identity, delegates backpressure once, and is not sent after cancellation", async()=>{
  for(const cancel of [false,true]) {
    const f=fixture(),r=execRequest(),pending=f.client.run(r.args,r.options),c=f.children[0]
    assert.deepEqual(c.writes,[],"no descriptor before native spawn and identity")
    c.stdin.end=(value,done)=>{c.writes.push(value);c.stdin.writableFinished=true;c.stdin.emit("finish");done?.();return false}
    const stopped=cancel?f.client.stopClients():null
    c.emit("spawn");c.stdin.emit("drain");c.stdin.emit("drain")
    assert.equal(c.writes.length,cancel?0:1)
    if(!cancel)assert.equal(c.writes[0].toString(),r.options.input)
    c.stdout.emit("data",Buffer.from("private-exec-output"));c.emit("exit",0,null);c.emit("close")
    const result=await pending;assert.equal(result.stdout,"");assert.equal(result.closed,true)
    if(cancel)assert.equal(await stopped,true)
    assert.equal(f.timers.size,0)
  }
})

test("native spawn exceptions keep their cause private behind a fixed local message",()=>{
  const original=Error("synthetic-secret diagnostic /foreign/argv")
  const f=fixture({spawn:()=>{throw original}})
  assert.throws(()=>f.client.run(inspect,{timeoutMs:100,maxBytes:128}),error=>error.message==="owned-docker-spawn-unavailable"&&error.cause===original)
  assert.equal(f.timers.size,0)
})

test("unexpected binary, commands, process options and host environment never reach native spawn",()=>{
  const f=fixture(),opts={env:{PATH:"/usr/bin:/bin",DOCKER_CONFIG:config},shell:false,detached:false,stdio:["ignore","pipe","pipe"]}
  for(const args of [["context","use",context],["system","prune"],["run","alpine"],["exec",id,"sh"],["stop","--time","10",id],["network","disconnect",id,id],["inspect","--format","{{.Id}}",id],["inspect",id,"--context",context]])assert.throws(()=>f.client.run(["--context",context,...args],{timeoutMs:100,maxBytes:128}),/refused/)
  for(const field of ["HOME","DOCKER_HOST","DOCKER_CONTEXT","NODE_OPTIONS","NODE_PATH","LD_PRELOAD","DYLD_INSERT_LIBRARIES","SSH_AUTH_SOCK","AWS_PROFILE","UNEXPECTED_SECRET"])assert.throws(()=>f.transport.spawn(binary,inspect,{...opts,env:{...opts.env,[field]:"synthetic-extra-secret"}}),/refused/)
  for(const extra of [{shell:true},{detached:true},{cwd:"/foreign"},{uid:0},{stdio:["inherit","pipe","pipe"]},{signal:new AbortController().signal}])assert.throws(()=>f.transport.spawn(binary,inspect,{...opts,...extra}),/refused/)
  assert.throws(()=>f.transport.spawn("/foreign/docker",inspect,opts),/refused/)
  assert.throws(()=>f.transport.spawn(binary,inspect,{...opts,env:{...opts.env,PATH:"/foreign/bin"}}),/refused/)
  assert.equal(f.calls.length,0);assert.equal(f.timers.size,0)
})

test("raw split UTF-8 and both output streams reach the real client's aggregate cap even during synchronous stop", async()=>{
  for(const maxBytes of [128,65]) {
    const f=fixture(),args=["--context",context,"network","create","--driver","bridge",`evals-${plan().binding.invocation_id}-egress`]
    const pending=f.client.run(args,{timeoutMs:100,maxBytes}),c=f.children[0];c.emit("spawn")
    c.stdout.emit("data",Buffer.from(id.slice(0,32)))
    c.kill=signal=>{c.signals.push(signal);c.stdout.emit("data",Buffer.from(id.slice(32)+"\n"));c.stderr.emit("data",Buffer.from("queued"));return true}
    const stopped=f.client.stopClients();c.emit("exit",0,null);c.emit("close")
    const result=await pending
    assert.equal(result.stdout,id+"\n");assert.equal(result.stderr,maxBytes===128?"queued":"")
    assert.equal(result.overflow,maxBytes===65);assert.equal(creationID(result),maxBytes===128?id:null)
    assert.equal(await stopped,true);assert.deepEqual(c.signals,["SIGTERM"])
  }
  const f=fixture(),pending=f.client.run(inspect,{timeoutMs:100,maxBytes:4}),c=f.children[0],bytes=Buffer.from("€xTAIL")
  c.emit("spawn");c.stdout.emit("data",bytes.subarray(0,1));c.stdout.emit("data",bytes.subarray(1));bytes.fill(0)
  c.emit("exit",17,null);c.emit("close")
  const result=await pending;assert.equal(result.stdout,"€x");assert.equal(result.code,17);assert.equal(result.overflow,true)
})

test("cancellation before spawn and hung drain retain unknown results; late lifecycle events cannot upgrade them", async()=>{
  const f=fixture(),r=execRequest(),pending=f.client.run(r.args,r.options),c=f.children[0]
  const first=f.client.stopClients(),second=f.client.stopClients();assert.deepEqual(c.signals,[])
  f.clock.tick();const result=await pending,snapshot=JSON.stringify(result)
  assert.equal(result.closed,false);assert.equal(await first,false);assert.equal(await second,false)
  c.emit("spawn");assert.deepEqual(c.signals,["SIGKILL"],"only the latest stop stage is delivered after spawn identity")
  assert.deepEqual(c.writes,[]);c.stdout.emit("data",Buffer.alloc(10000));c.emit("error",Error("late-private"))
  c.emit("exit",0,null);c.emit("exit",9,"SIGTERM");c.emit("close");c.emit("close")
  assert.equal(JSON.stringify(result),snapshot);assert.equal(f.client.closed(),true);assert.equal(f.timers.size,0)
})

test("exit, aggregate close and spawn errors are distinct; late errors and streams remain observed", async()=>{
  for(const mode of ["exit-only","close-only","spawn-error"]) {
    const f=fixture(),pending=f.client.run(inspect,{timeoutMs:100,maxBytes:128}),c=f.children[0]
    if(mode==="spawn-error")c.emit("error",Error("private-spawn-diagnostic"))
    else {c.emit("spawn");c.stdout.emit("data",Buffer.from(id));c.stdout.emit("end");c.stderr.emit("end");c.emit(mode==="exit-only"?"exit":"close",0,null)}
    if(mode!=="spawn-error")f.clock.tick()
    f.clock.tick();const result=await pending,snapshot=JSON.stringify(result)
    assert.equal(result.closed,false);assert.equal(f.client.closed(),false);assert.deepEqual(c.signals,[])
    if(mode==="exit-only")assert.equal(creationID(result),id)
    c.stdout.emit("error",Error("late-output"));c.stderr.emit("error",Error("late-output"));c.emit("error",Error("late-child"))
    c.emit("exit",1,null);c.emit("close")
    assert.equal(JSON.stringify(result),snapshot);assert.equal(f.client.closed(),true);assert.equal(f.timers.size,0)
  }
})

test("pre-aborted actual containment never spawns a native client",async()=>{
  const f=fixture(),controller=new AbortController();controller.abort()
  const result=await containTrial(plan(),{docker:f.client,clock:f.clock,signal:controller.signal,journal:async()=>{},validateInputs:()=>assert.fail("aborted before inputs"),measure:async()=>true,finalize:()=>assert.fail("no finalization")})
  assert.equal(f.calls.length,0);assert.equal(result.reason,"cancelled");assert.equal(result.successor_allowed,false);assert.equal(f.timers.size,0)
})

test("stdin loss, oversized or foreign descriptors remain bounded and cannot dispatch buffered input",async()=>{
  for(const mode of ["oversized","foreign","malformed","throw","reject","error"]) {
    const f=fixture(),r=execRequest()
    if(mode==="oversized")r.options.input="x".repeat(65537)
    if(mode==="foreign")r.options.input=r.options.input.replace(id,"b".repeat(64))
    if(mode==="malformed")r.options.input="synthetic-secret not-json"
    const pending=f.client.run(r.args,r.options),c=f.children[0]
    if(mode==="throw")c.stdin.end=()=>{throw Error("private-stdin")}
    if(mode==="reject")c.stdin.end=()=>Promise.reject(Error("private-stdin"))
    if(mode==="error")c.stdin.end=()=>c.stdin.emit("error",Error("private-stdin"))
    c.emit("spawn");await new Promise(setImmediate);f.clock.tick()
    const result=await pending
    assert.equal(result.closed,false,mode);assert.equal(result.truncated,true,mode)
    assert.equal(JSON.stringify(result).includes("private"),false);assert.deepEqual(c.writes,[])
    c.emit("exit",null,"SIGKILL");c.emit("close");c.stdin.emit("error",Error("late-private"))
    assert.equal(f.client.closed(),true);assert.equal(f.timers.size,0)
  }
})

test("unavailable or asynchronous initial identity grants neither input nor signal authority",async()=>{
  for(const readIdentity of [()=>null,()=>Promise.reject(Error("private-identity")),()=>{throw Error("private-identity")},c=>({pid:c.pid+1,start:"x"}),c=>({pid:c.pid,start:""})]) {
    const f=fixture({readIdentity}),r=execRequest(),pending=f.client.run(r.args,r.options),c=f.children[0]
    c.emit("spawn");await new Promise(setImmediate);f.clock.tick()
    const result=await pending
    assert.equal(result.closed,false);assert.equal(result.truncated,true)
    assert.deepEqual(c.signals,[]);assert.deepEqual(c.writes,[])
    c.emit("exit",0,null);c.emit("close");assert.equal(f.client.closed(),true)
  }
})

test("signal failures are requests only and exited handles are never signaled again",async()=>{
  for(const mode of ["throw","reject","false","exit-before-event"]) {
    const f=fixture(),pending=f.client.run(inspect,{timeoutMs:100,maxBytes:128}),c=f.children[0];c.emit("spawn")
    c.kill=s=>{c.signals.push(s);if(mode==="throw")throw Error("private-kill");if(mode==="reject")return Promise.reject(Error("private-kill"));return false}
    if(mode==="exit-before-event")c.exitCode=0
    const stopped=f.client.stopClients();f.clock.tick();const result=await pending
    await new Promise(setImmediate)
    assert.equal(result.closed,false);assert.equal(await stopped,false)
    assert.deepEqual(c.signals,mode==="exit-before-event"?[]:["SIGTERM","SIGKILL"])
    c.emit("exit",0,null);c.emit("close");await f.client.stopClients()
    assert.equal(f.client.closed(),true);assert.equal(result.closed,false);assert.equal(f.timers.size,0)
  }
})

test("exec rejects mismatched pass-through values and credentials without native spawn",()=>{
  const f=fixture(),r=execRequest()
  for(const env of [{...r.options.env,HOME:"/foreign/home"},{...r.options.env,PATH:"/foreign/bin"},{...r.options.env,OPENCODE_PASSWORD:"not-a-private-password"},{...r.options.env,EVALS_STORE:"/parent/store"},{...r.options.env,EXTRA:"synthetic-secret"}])assert.throws(()=>f.client.run(r.args,{...r.options,env}),/refused/)
  const foreign=createOwnedDockerClient({binary,config,context,credentialValues:{OPENCODE_API_KEY:"wrong-secret"}},{spawn:f.transport.spawn,clock:f.clock})
  assert.throws(()=>foreign.run(r.args,r.options),/refused/)
  assert.equal(f.calls.length,0)
})

test("owner pins and spawn arguments are captured by value; no option grants native qualification",async()=>{
  const f=fixture({qualified:true}),r=execRequest()
  f.owner.plan.work="/foreign/work";f.owner.plan.descriptor.options.cases="foreign";f.owner.credentialValues.OPENCODE_API_KEY="foreign-secret"
  const pending=f.client.run(r.args,r.options),c=f.children[0]
  r.args[2]="system";r.options.env.HOME="/foreign/home"
  c.emit("spawn");c.emit("exit",0,null);c.emit("close")
  assert.equal((await pending).closed,true);assert.equal(f.calls[0].args[2],"exec");assert.equal(f.calls[0].opts.env.HOME,"/work/home")
  assert.equal(f.calls[0].opts.env.OPENCODE_API_KEY,"synthetic-secret")
  assert.equal(f.transport.qualified,false);assert.equal(f.transport.reason,"native-transport-unqualified")
  assert.equal(Object.isFrozen(f.transport),true)
})

test("real Writable loss before spawn or during a partial write reaches the client before aggregate settlement",async()=>{
  for(const mode of ["before-spawn","pending-write","exit-before-flush","callback-error","pending-at-close","close-before-exit","destroy-before-events"]) {
    let completeWrite
    const f=fixture({},c=>{
      c.stdin=new Writable({write(bytes,_encoding,done){c.writes.push(Buffer.from(bytes.subarray(0,3)));completeWrite=done}})
    }),r=execRequest(),pending=f.client.run(r.args,r.options),c=f.children[0]
    if(mode==="before-spawn") {c.stdin.destroy();await new Promise(setImmediate)}
    if(mode!=="exit-before-flush")c.emit("spawn")
    if(mode==="pending-write") {c.stdin.destroy();await new Promise(setImmediate)}
    if(mode==="callback-error") {completeWrite(Error("private-write-failure"));await new Promise(setImmediate)}
    if(mode==="destroy-before-events")c.stdin.destroy()
    if(mode==="close-before-exit")c.emit("close",0,null)
    c.emit("exit",0,null);c.emit("close",0,null)
    const result=await pending
    assert.equal(result.closed,true,mode);assert.equal(result.truncated,true,mode)
    assert.equal(c.writes.length,["before-spawn","exit-before-flush"].includes(mode)?0:1)
    assert.equal(f.client.closed(),true);assert.equal(f.timers.size,0)
    const snapshot=JSON.stringify(result);c.stdin.destroy();await new Promise(setImmediate)
    c.stdin.emit("error",Error("late-private"));assert.equal(JSON.stringify(result),snapshot)
  }
})

test("failed end callback emits one fixed input-loss error before reentrant child settlement",async()=>{
  let endCallback
  const f=fixture({},c=>{c.stdin.end=(bytes,done)=>{c.writes.push(Buffer.from(bytes.subarray(0,3)));endCallback=done;return c.stdin}})
  const events=[]
  const client=createOwnedDockerClient({binary,config,context,credentialValues:{OPENCODE_API_KEY:"synthetic-secret"}}, {clock:f.clock,graceMs:10,spawn(...args){
    const handle=f.transport.spawn(...args);handle.on("error",error=>events.push(error.message));handle.on("close",()=>events.push("close"));return handle
  }})
  const r=execRequest(),pending=client.run(r.args,r.options),c=f.children[0];c.emit("spawn")
  c.kill=signal=>{c.signals.push(signal);c.emit("exit",0,null);c.emit("close",0,null);return true}
  endCallback(Error("private-end-failure"))
  const result=await pending
  assert.equal(result.truncated,true);assert.equal(result.closed,true)
  assert.deepEqual(events,["owned-docker-input-lost","close"])
  assert.equal(c.writes.length,1);assert.deepEqual(c.signals,["SIGTERM"])
  const snapshot=JSON.stringify(result);endCallback(Error("late-private"));c.stdin.emit("close")
  assert.equal(JSON.stringify(result),snapshot);assert.deepEqual(events,["owned-docker-input-lost","close"]);assert.equal(f.timers.size,0)
})

test("Linux comm delimiter and truncated stat refuse identity without changing the valid state/start policy",async()=>{
  const fields=["S",...Array(18).fill("0"),"123","0"].join(" "),prefix="200 (docker (child) name)"
  for(const text of [prefix+" "+fields,prefix+"X"+fields,prefix+fields,prefix+"\t"+fields,prefix,prefix+" ",prefix+" S 0",prefix.slice(0,-1)+" "+fields]) {
    const f=fixture({readIdentity:undefined,platform:"linux",readFile:()=>text}),pending=f.client.run(inspect,{timeoutMs:100,maxBytes:128}),c=f.children[0]
    c.emit("spawn");const stopped=f.client.stopClients();f.clock.tick()
    const valid=text===prefix+" "+fields
    assert.deepEqual(c.signals,valid?["SIGTERM","SIGKILL"]:[],text)
    assert.equal((await pending).truncated,!valid);assert.equal(await stopped,false)
    c.emit("exit",0,null);c.emit("close");assert.equal(f.client.closed(),true);assert.equal(f.timers.size,0)
  }
})

test("real Writable normal finish and close send one descriptor without loss or remote acknowledgement",async()=>{
  let completeWrite
  const f=fixture({},c=>{c.stdin=new Writable({highWaterMark:1,write(bytes,_encoding,done){c.writes.push(Buffer.from(bytes));completeWrite=done}})})
  const r=execRequest(),pending=f.client.run(r.args,r.options),c=f.children[0];c.emit("spawn")
  assert.equal(c.stdin.writableFinished,false);assert.equal(c.writes.length,1)
  completeWrite();await new Promise(setImmediate)
  assert.equal(c.stdin.writableFinished,true);assert.equal(c.stdin.closed,true)
  c.emit("exit",0,null);c.emit("close",0,null)
  const result=await pending;assert.equal(result.truncated,false);assert.equal(result.closed,true)
  assert.equal(c.writes[0].toString(),r.options.input);assert.deepEqual(c.signals,[])
  const snapshot=JSON.stringify(result);c.stdin.emit("error",Error("late-private"));assert.equal(JSON.stringify(result),snapshot)
  assert.equal(f.transport.qualified,false);assert.equal(f.timers.size,0)
})
