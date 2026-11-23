import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import { createOwnedDockerClient } from "../src/run/owned-docker-client.mjs"
import { createOwnedDockerProcess } from "../src/run/owned-docker-process.mjs"
import { createWarmedDarwinIdentityReader as createDarwinIdentityReader } from "./fixtures/warmed-darwin-identity.mjs"

const context="colima-mem-evals-20261122",binary="/pinned/docker",config="/parent/docker",id="a".repeat(64)
const plan=()=>({context,dockerConfig:config,binding:{invocation_id:"11111111-1111-4111-8111-111111111111",manifest_sha256:"b".repeat(64),trial_id:"case-a"},image:`sha256:${"c".repeat(64)}`,imageEnv:["PATH=/usr/bin:/bin"],user:"1000:1000",control:"/parent/control",store:"/parent/store",work:"/staged/work",inputs:"/staged/inputs",binaries:"/staged/bin",inputs_sha256:"d".repeat(64),binaries_sha256:"e".repeat(64),allow:["opencode.ai"],credentialNames:["OPENCODE_API_KEY"],timeoutMs:1000,cleanupMs:1000,operationMs:100,outputBytes:4096,descriptor:{options:{plugin:"mem",iteration:"trial-a",model:"opencode/deepseek-v4.1-flash#low",auth:"env:OPENCODE_API_KEY",cases:"case-a",casesDir:"/inputs/cases",set:"set-a",trials:1,parallel:1,arm:"/inputs/arm",world:"/inputs/harness/worlds/mem/index.mjs",host:"2.2.6",timeout:1,stale:"refuse",tools:"locked",isolation:"owned-container",harnessRetries:0,processGroup:"inherited",condition:"direct"}}})
const inspect=["--context",context,"inspect",id]
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
function fixture() {
  let now=0,next=0
  const timers=new Map(),helpers=[],children=[],writes=[],signals=[]
  const clock={now:()=>now,set(fn,ms){timers.set(++next,{fn,at:now+ms});return next},clear:k=>timers.delete(k),tick(ms){now+=ms;for(const [k,t] of [...timers])if(t.at<=now){timers.delete(k);t.fn()}}}
  const bytes=Buffer.from("synthetic-not-executable"),pins={schema:"qmac-owner/1",platform:"darwin",arch:"arm64",runId:"offline",cwd:"/private/owner",helper:{path:"/private/owner/identity",sha256:createHash("sha256").update(bytes).digest("hex"),size:bytes.length,mode:0o555,arch:"arm64"},sourceSha256:"a".repeat(64),buildManifestSha256:"b".repeat(64),platformProfileSha256:"c".repeat(64),nodeSha256:"d".repeat(64),lookupMs:100,cleanupMs:100}
  const identityOwner=createDarwinIdentityReader(pins,{platform:"darwin",arch:"arm64",clock,readFile:()=>bytes,realpath:p=>p,lstat:p=>p===pins.cwd?{isDirectory:()=>true,mode:0o40700}:{isFile:()=>true,size:bytes.length,mode:0o100555},spawn:()=>{const h=new EventEmitter();h.pid=901+helpers.length;h.stdout=new EventEmitter();h.kill=()=>assert.fail("no helper signals");helpers.push(h);return h}})
  const transport=createOwnedDockerProcess({binary,config,context,plan:plan(),credentialValues:{OPENCODE_API_KEY:"synthetic"}},{platform:"darwin",identityOwner,spawn:()=>{
    const c=new EventEmitter();c.pid=501;c.exitCode=null;c.signalCode=null;c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.stdin.writableFinished=false
    c.stdin.end=(b,done)=>{writes.push(b);c.stdin.writableFinished=true;c.stdin.emit("finish");done?.()};c.kill=name=>{signals.push(name);return true};children.push(c);return c
  }})
  const client=createOwnedDockerClient({binary,config,context,credentialValues:{OPENCODE_API_KEY:"synthetic"}},{spawn:transport.spawn,clock,graceMs:100})
  const finish=(h=helpers.at(-1),usec="000456")=>{h.stdout.emit("data",Buffer.from(`QMAC1 501 123 ${usec}\n`));h.emit("exit",0,null);h.emit("close",0,null)}
  const close=()=>{const c=children[0];c.emit("exit",0,null);c.emit("close",0,null)}
  const exec=()=>{
    const p=plan(),env={PATH:"/opt/evals/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",HOME:"/work/home",TMPDIR:"/work/tmp",EVALS_TMP:"/work/tmp",EVALS_STORE:"/work/store",XDG_CONFIG_HOME:"/work/home/.config",XDG_DATA_HOME:"/work/xdg-data",XDG_STATE_HOME:"/work/xdg-state",XDG_CACHE_HOME:"/work/home/.cache",EVALS_CAPS:"/inputs/caps.json",EVALS_MODELS_CATALOG:"/inputs/models.json",EVALS_MODEL_MAP:"/inputs/model-map.json",EVALS_NODE:"/opt/evals/bin/node",EVALS_OPENCODE_BIN:"/opt/evals/bin/opencode",OPENCODE_BIN_2_2_6:"/opt/evals/bin/opencode",OPENCODE_PASSWORD:"f".repeat(48),HTTPS_PROXY:"http://egress:3128",HTTP_PROXY:"http://egress:3128",NO_PROXY:"127.0.0.1,localhost"}
    return client.run(["--context",context,"exec","-i","-w","/work",...[...Object.keys(env),"OPENCODE_API_KEY"].flatMap(n=>["-e",n]),id,"/opt/evals/bin/node","/inputs/harness/scripts/run-contained-trial.mjs"],{env,credentialNames:["OPENCODE_API_KEY"],input:JSON.stringify({...p.descriptor,schema:"oc-owned-launch/1",binding:p.binding,container_id:id,context,inputs_sha256:p.inputs_sha256,binaries_sha256:p.binaries_sha256}),timeoutMs:1000,maxBytes:128})
  }
  return {client,transport,identityOwner,clock,timers,helpers,children,writes,signals,finish,close,exec}
}

test("actual client defers input until owned async identity closes, without default activation",async()=>{
  const f=fixture(),result=f.exec();f.children[0].emit("spawn")
  assert.equal(f.helpers.length,1);assert.equal(f.writes.length,0)
  f.finish();await flush();assert.equal(f.writes.length,1);assert.equal(f.transport.qualified,false)
  f.close();assert.equal((await result).closed,true);assert.equal(f.identityOwner.closed(),true);assert.equal(f.timers.size,0)
})

test("abort or target lifecycle during initial await never delivers input or revives authority",async()=>{
  for(const action of ["abort","exit","close","pid"]) {
    const f=fixture(),result=f.exec(),c=f.children[0];c.emit("spawn")
    if(action==="abort")f.client.stopClients();else if(action==="pid")c.pid=502;else c.emit(action,0,null)
    f.finish();await flush();assert.equal(f.writes.length,0);assert.deepEqual(f.signals,[])
    f.clock.tick(100);await flush();f.close();await result
    assert.equal(f.identityOwner.closed(),true);assert.equal(f.timers.size,0)
  }
})

test("TERM and KILL require separate fresh tuple observations on the original child",async()=>{
  const f=fixture(),result=f.client.run(inspect,{timeoutMs:1000,maxBytes:128});f.children[0].emit("spawn");f.finish();await flush()
  const stopped=f.client.stopClients();await flush();assert.equal(f.helpers.length,2);assert.deepEqual(f.signals,[])
  f.finish();await flush();assert.deepEqual(f.signals,["SIGTERM"])
  f.clock.tick(100);await flush();assert.equal(f.helpers.length,3);assert.deepEqual(f.signals,["SIGTERM"])
  f.finish();await flush();assert.deepEqual(f.signals,["SIGTERM","SIGKILL"])
  assert.equal((await result).closed,false);assert.equal(await stopped,false)
  f.close();assert.equal(f.client.closed(),true);assert.equal(f.timers.size,0)
})

test("superseding KILL waits for obsolete TERM helper reaping before a fresh lookup",async()=>{
  const f=fixture(),result=f.client.run(inspect,{timeoutMs:1000,maxBytes:128});f.children[0].emit("spawn");f.finish();await flush()
  f.client.stopClients();await flush();const term=f.helpers[1]
  f.clock.tick(100);await flush();assert.equal(f.helpers.length,2);assert.deepEqual(f.signals,[])
  f.finish(term);await flush();assert.equal(f.helpers.length,3);assert.deepEqual(f.signals,[])
  f.finish();await flush();assert.deepEqual(f.signals,["SIGKILL"])
  assert.equal((await result).closed,false);f.close();assert.equal(f.timers.size,0)
})

test("unknown TERM helper cleanup blocks KILL and successor even after Docker client closure",async()=>{
  const f=fixture(),result=f.client.run(inspect,{timeoutMs:1000,maxBytes:128});f.children[0].emit("spawn");f.finish();await flush()
  f.client.stopClients();await flush();f.clock.tick(100);await flush();f.clock.tick(100);await flush()
  assert.equal((await result).closed,false);f.close();assert.equal(f.client.closed(),true);assert.equal(f.identityOwner.closed(),false)
  assert.throws(()=>f.client.run(inspect,{timeoutMs:1000,maxBytes:128}),/^Error: owned-docker-identity-unavailable$/)
  assert.equal(f.children.length,1);assert.equal(f.helpers.length,2);assert.deepEqual(f.signals,[])
  f.finish();await flush();assert.equal(f.helpers.length,2);assert.deepEqual(f.signals,[]);assert.equal(f.identityOwner.closed(),true)
  await f.identityOwner.stop();assert.equal(f.identityOwner.available(),false);assert.equal(f.timers.size,0)
})

test("changed microseconds, PID, exit or close during a signal lookup never authorize a signal",async()=>{
  for(const action of ["usec","pid","exit","close","exitCode","signalCode"]) {
    const f=fixture(),result=f.client.run(inspect,{timeoutMs:1000,maxBytes:128}),c=f.children[0];c.emit("spawn");f.finish();await flush()
    f.client.stopClients();await flush()
    if(action==="pid")c.pid=502;else if(action==="exit"||action==="close")c.emit(action,0,null);else if(action==="exitCode")c.exitCode=0;else if(action==="signalCode")c.signalCode="SIGTERM"
    f.finish(undefined,action==="usec"?"000457":"000456");await flush();assert.deepEqual(f.signals,[])
    f.clock.tick(100);await flush();f.close();await result;assert.deepEqual(f.signals,[]);assert.equal(f.timers.size,0)
  }
})

test("owner stop between helper success and initial continuation cannot revive bootstrap authority",async()=>{
  const f=fixture(),result=f.exec();f.children[0].emit("spawn");f.finish();await f.identityOwner.stop();await flush()
  assert.equal(f.writes.length,0);assert.deepEqual(f.signals,[])
  f.close();await result;assert.equal(f.timers.size,0)
})

test("actual client refuses initial denial, malformed, overflow, error and incomplete helper lifecycles",async()=>{
  for(const mode of ["denied","malformed","overflow","error","no-exit","no-close","hang"]) {
    const f=fixture(),result=f.exec();f.children[0].emit("spawn");const h=f.helpers[0]
    if(mode==="denied") {h.emit("exit",65,null);h.emit("close",65,null)}
    if(mode==="malformed") {h.stdout.emit("data",Buffer.from("not identity"));h.emit("exit",0,null);h.emit("close",0,null)}
    if(mode==="overflow")h.stdout.emit("data",Buffer.alloc(65))
    if(mode==="error")h.emit("error",new Error("private helper failure"))
    if(mode==="no-exit")h.emit("close",0,null)
    if(mode==="no-close")h.emit("exit",0,null)
    await flush();f.clock.tick(100);await flush();f.clock.tick(100);await flush()
    assert.equal(f.writes.length,0);assert.deepEqual(f.signals,[]);assert.equal((await result).closed,false)
    f.close();assert.equal(f.client.closed(),true)
    if(!["denied","malformed"].includes(mode)) {
      assert.equal(f.identityOwner.closed(),false)
      assert.throws(()=>f.client.run(inspect,{timeoutMs:1000,maxBytes:128}),/^Error: owned-docker-identity-unavailable$/)
      f.finish(h);await flush();assert.equal(f.writes.length,0)
    }
    assert.equal(f.identityOwner.closed(),true);assert.equal(f.timers.size,0)
  }
})

test("exit or shutdown during obsolete-helper reconciliation suppresses the newer KILL lookup",async()=>{
  for(const mode of ["exit","close","stop"]) {
    const f=fixture(),result=f.client.run(inspect,{timeoutMs:1000,maxBytes:128});f.children[0].emit("spawn");f.finish();await flush()
    f.client.stopClients();await flush();f.clock.tick(100);await flush()
    const stop=mode==="stop"?f.identityOwner.stop():null
    if(mode!=="stop")f.children[0].emit(mode,0,null)
    f.finish();await flush();if(stop)assert.equal(await stop,true)
    assert.equal(f.helpers.length,2);assert.deepEqual(f.signals,[]);f.close();await result;assert.equal(f.timers.size,0)
  }
})
