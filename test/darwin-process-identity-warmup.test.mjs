import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createDarwinIdentityReader } from "../src/run/darwin-process-identity.mjs"

function fixture(overrides={},spawnDelay=0) {
  let now=0,next=0
  const timers=new Map(),calls=[],helpers=[],bytes=Buffer.from("synthetic-not-executable")
  const clock={now:()=>now,set(fn,ms){timers.set(++next,{fn,at:now+ms});return next},clear:k=>timers.delete(k),tick(ms){now+=ms;for(const [k,t] of [...timers])if(t.at<=now){timers.delete(k);t.fn()}}}
  const pins={schema:"qmac-owner/1",platform:"darwin",arch:"arm64",runId:"warmup-test",cwd:"/private/owner",helper:{path:"/private/owner/identity",sha256:createHash("sha256").update(bytes).digest("hex"),size:bytes.length,mode:0o555,arch:"arm64"},sourceSha256:"a".repeat(64),buildManifestSha256:"b".repeat(64),platformProfileSha256:"c".repeat(64),nodeSha256:"d".repeat(64),lookupMs:100,cleanupMs:100}
  const deps={clock,platform:"darwin",arch:"arm64",readFile:()=>bytes,realpath:p=>p,lstat:p=>p===pins.cwd?{isDirectory:()=>true,mode:0o40700}:{isFile:()=>true,size:bytes.length,mode:0o100555},spawn:(file,args,options)=>{const h=new EventEmitter();h.pid=901+helpers.length;h.stdout=new EventEmitter();h.kill=()=>assert.fail("no signals");calls.push({file,args,options});helpers.push(h);clock.tick(spawnDelay);return h},...overrides}
  const owner=createDarwinIdentityReader(pins,deps),target=new EventEmitter();target.pid=501;target.exitCode=null;target.signalCode=null
  const finish=(h=helpers.at(-1),code=64,text="",signal=null)=>{if(text)h.stdout.emit("data",Buffer.from(text));h.emit("exit",code,signal);h.emit("close",code,signal)}
  return {owner,target,clock,timers,calls,helpers,finish}
}

test("construction warms exactly the deployed asset before admission, then preserves the 100ms lookup budget",async()=>{
  const f=fixture()
  assert.deepEqual(f.calls,[{file:"/private/owner/identity",args:["0"],options:{cwd:"/private/owner",env:{},shell:false,detached:false,stdio:["ignore","pipe","ignore"]}}])
  assert.equal(f.owner.available(),false);assert.equal(f.owner.closed(),false)
  f.owner.register(f.target);assert.equal(await f.owner.readIdentity(f.target),null);assert.equal(f.calls.length,1)
  let ready=false;f.owner.ready().then(v=>ready=v)
  f.clock.tick(300);f.helpers[0].emit("exit",64,null);await Promise.resolve();assert.equal(ready,false)
  f.helpers[0].emit("close",64,null);assert.equal(await f.owner.ready(),true);assert.equal(f.owner.available(),true);assert.equal(f.owner.closed(),true)
  const lookup=f.owner.readIdentity(f.target);assert.deepEqual(f.calls[1].args,["501"])
  f.clock.tick(10);f.finish(undefined,0,"QMAC1 501 123 000456\n")
  assert.deepEqual(await lookup,{pid:501,start:"darwin-bsd-v1:123:000456"})
  const timed=f.owner.readIdentity(f.target);f.clock.tick(100);assert.equal(await timed,null);assert.equal(f.owner.closed(),false)
  f.finish(undefined,0,"QMAC1 501 123 000456\n");assert.equal(f.calls.length,3);assert.equal(f.timers.size,0)
})

test("static operand 0 refusal precedes all C process calls",()=>{
  const c=readFileSync(new URL("../native/darwin-process-identity.c",import.meta.url),"utf8")
  const first=c.indexOf("if (argc != 2 || argv[1][0] < '1' || argv[1][0] > '9') return 64;")
  assert.ok(first>0);for(const call of ["getppid()","getpid()","getuid()","proc_pidinfo(pid"])assert.ok(c.indexOf(call)>first)
})

test("wrong exit, signal, output and spawn error permanently refuse warm-up without retry",async()=>{
  for(const mode of ["zero","other","signal","output","error","throw"]) {
    const f=fixture(mode==="throw"?{spawn:()=>{throw Error("private native error")}}:{})
    if(mode==="error")f.helpers[0].emit("error",new Error("private helper error"))
    if(mode!=="throw")f.finish(undefined,mode==="zero"?0:mode==="other"?65:64,mode==="output"?"QMAC1 501 123 000456\n":"",mode==="signal"?"SIGTERM":null)
    assert.equal(await f.owner.ready(),false);assert.equal(f.owner.available(),false);assert.equal(f.owner.closed(),true)
    f.owner.register(f.target);assert.equal(await f.owner.readIdentity(f.target),null)
    assert.equal(await f.owner.reconcile(),true);assert.equal(await f.owner.stop(),true)
    assert.equal(f.calls.length,mode==="throw"?0:1);assert.equal(f.timers.size,0)
  }
})

test("warm-up timeout and missing close retain ownership after the separate 100ms cleanup observation",async()=>{
  for(const event of [null,"exit","close"]) {
    const f=fixture();if(event)f.helpers[0].emit(event,64,null)
    let settled=false;f.owner.ready().then(()=>settled=true)
    f.clock.tick(999);await Promise.resolve();assert.equal(settled,false);assert.equal(f.owner.available(),false)
    f.clock.tick(1);assert.equal(await f.owner.ready(),false);assert.equal(f.owner.closed(),false)
    const stopped=f.owner.stop();f.clock.tick(99);let reaped=false;stopped.then(()=>reaped=true);await Promise.resolve();assert.equal(reaped,false)
    f.clock.tick(1);assert.equal(await stopped,false);assert.equal(f.owner.closed(),false)
    f.finish();assert.equal(f.owner.closed(),true);assert.equal(f.owner.available(),false);assert.equal(await f.owner.ready(),false)
    assert.equal(f.calls.length,1);assert.equal(f.timers.size,0)
  }
})

test("stop and reconcile account for pending warm-up without fabricating a reap or restoring admission",async()=>{
  const f=fixture(),observed=f.owner.reconcile(),stopped=f.owner.stop()
  assert.equal(await f.owner.ready(),false);assert.equal(f.owner.closed(),false);assert.equal(f.owner.available(),false)
  f.clock.tick(99);f.finish();assert.equal(await observed,true);assert.equal(await stopped,true)
  assert.equal(f.owner.closed(),true);assert.equal(f.owner.available(),false);assert.equal(f.calls.length,1);assert.equal(f.timers.size,0)
})

test("missing deployed asset refuses before any warm-up execution",()=>{
  let calls=0
  assert.throws(()=>fixture({lstat:()=>{throw Error("missing")},spawn:()=>{calls++;assert.fail("no exec")}}),/^Error: darwin-identity-pins-refused$/)
  assert.equal(calls,0)
})

test("warm-up deadline includes synchronous spawn time and exact deadline refuses",async()=>{
  for(const elapsed of [999,1000]) {
    const f=fixture({},elapsed);f.finish()
    assert.equal(await f.owner.ready(),elapsed===999);assert.equal(f.owner.available(),elapsed===999);assert.equal(f.timers.size,0)
  }
})

test("warm-up failed spawn requires error plus close, and established PID still requires exit",async()=>{
  const h=new EventEmitter();h.stdout=new EventEmitter()
  const f=fixture({spawn:()=>h});h.emit("error",new Error("private"))
  assert.equal(await f.owner.ready(),false);assert.equal(f.owner.closed(),false)
  h.emit("close",-1,null);assert.equal(f.owner.closed(),true);assert.equal(f.owner.available(),false);assert.equal(f.timers.size,0)
  const g=fixture();g.helpers[0].emit("error",new Error("private"));g.helpers[0].emit("close",-1,null)
  assert.equal(await g.owner.ready(),false);assert.equal(g.owner.closed(),false)
  g.helpers[0].emit("exit",64,null);assert.equal(g.owner.closed(),true);assert.equal(g.owner.available(),false);assert.equal(g.timers.size,0)
})

test("late warm-up events cannot cancel a lookup or erase its ownership",async()=>{
  const f=fixture(),warm=f.helpers[0];f.finish();assert.equal(await f.owner.ready(),true)
  f.owner.register(f.target);const lookup=f.owner.readIdentity(f.target)
  warm.emit("error",new Error("late"));warm.emit("close",64,null)
  assert.equal(f.owner.closed(),false);assert.equal(f.owner.available(),false)
  f.finish(undefined,0,"QMAC1 501 123 000456\n")
  assert.deepEqual(await lookup,{pid:501,start:"darwin-bsd-v1:123:000456"})
  assert.equal(f.owner.available(),true);assert.equal(f.timers.size,0)
})
