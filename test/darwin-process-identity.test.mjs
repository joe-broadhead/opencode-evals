import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import { createWarmedDarwinIdentityReader as createDarwinIdentityReader } from "./fixtures/warmed-darwin-identity.mjs"

const bytes=Buffer.from("synthetic-not-an-executable")
const digest=createHash("sha256").update(bytes).digest("hex")
const pins=()=>({schema:"qmac-owner/1",platform:"darwin",arch:"arm64",runId:"offline-test",cwd:"/private/owner",helper:{path:"/private/owner/identity",sha256:digest,size:bytes.length,mode:0o555,arch:"arm64"},sourceSha256:"a".repeat(64),buildManifestSha256:"b".repeat(64),platformProfileSha256:"c".repeat(64),nodeSha256:"d".repeat(64),lookupMs:100,cleanupMs:100})
function fixture() {
  let now=0,n=0
  const timers=new Map(),calls=[],helpers=[]
  const clock={now:()=>now,set(fn,ms){timers.set(++n,{fn,at:now+ms});return n},clear:k=>timers.delete(k),tick(ms){now+=ms;for(const [k,t] of [...timers])if(t.at<=now){timers.delete(k);t.fn()}}}
  const deps={clock,platform:"darwin",arch:"arm64",readFile:()=>bytes,lstat:p=>p==="/private/owner"?{isDirectory:()=>true,mode:0o40700}:{isFile:()=>true,size:bytes.length,mode:0o100555},realpath:p=>p,spawn:(file,args,options)=>{
    const c=new EventEmitter();c.pid=901+helpers.length;c.stdout=new EventEmitter();c.kill=()=>assert.fail("no helper signal authority");calls.push({file,args,options});helpers.push(c);return c
  }}
  const owner=createDarwinIdentityReader(pins(),deps)
  const target=new EventEmitter();target.pid=501;target.exitCode=null;target.signalCode=null
  owner.register(target)
  const finish=(c=helpers.at(-1),text="QMAC1 501 123 000456\n",code=0)=>{c.stdout.emit("data",Buffer.from(text));c.emit("exit",code,null);c.emit("close",code,null)}
  return {owner,target,deps,clock,timers,calls,helpers,finish}
}
test("pinned helper reads only registered original handles and requires exit plus aggregate close",async()=>{
  const f=fixture();assert.equal(await f.owner.readIdentity({pid:501}),null);assert.equal(f.calls.length,0)
  const pending=f.owner.readIdentity(f.target);const c=f.helpers[0]
  assert.equal(f.owner.closed(),false);assert.equal(f.owner.available(),false)
  assert.deepEqual(f.calls,[{file:"/private/owner/identity",args:["501"],options:{cwd:"/private/owner",env:{},shell:false,detached:false,stdio:["ignore","pipe","ignore"]}}])
  c.stdout.emit("data",Buffer.from("QMAC1 501 123 000456\n"));c.emit("exit",0,null)
  let settled=false;pending.then(()=>settled=true);await Promise.resolve();assert.equal(settled,false)
  assert.equal(f.owner.closed(),false);c.emit("close",0,null)
  assert.deepEqual(await pending,{pid:501,start:"darwin-bsd-v1:123:000456"})
  assert.equal(f.owner.closed(),true);assert.equal(f.owner.available(),true);assert.equal(f.timers.size,0)
})

test("timeout and stop revoke late results without reaping, queuing or signaling helpers",async()=>{
  const f=fixture(),pending=f.owner.readIdentity(f.target)
  assert.equal(await f.owner.readIdentity(f.target),null);assert.equal(f.calls.length,1)
  f.clock.tick(100);assert.equal(await pending,null)
  assert.equal(f.owner.closed(),false);assert.equal(f.owner.available(),false)
  const stop=f.owner.stop();f.clock.tick(99);let settled=false;stop.then(()=>settled=true);await Promise.resolve();assert.equal(settled,false)
  f.clock.tick(1);assert.equal(await stop,false);assert.equal(f.owner.closed(),false)
  f.finish();assert.equal(f.owner.closed(),true);assert.equal(f.owner.available(),false)
  assert.equal(await f.owner.readIdentity(f.target),null);assert.equal(f.calls.length,1);assert.equal(f.timers.size,0)
})

test("abort, missing exit, missing close and EOF never fabricate helper ownership closure",async()=>{
  for(const event of ["abort","exit","close","end"]) {
    const f=fixture(),controller=new AbortController(),pending=f.owner.readIdentity(f.target,{signal:controller.signal}),c=f.helpers[0]
    if(event==="abort")controller.abort();else if(event==="end")c.stdout.emit("end");else c.emit(event,0,null)
    f.clock.tick(100);assert.equal(await pending,null);assert.equal(f.owner.closed(),false)
    const wait=f.owner.reconcile();f.clock.tick(100);assert.equal(await wait,false)
    f.finish();assert.equal(f.owner.closed(),true);assert.equal(f.timers.size,0)
  }
})

test("bounded exact ASCII records and exit status independently fail closed",async()=>{
  const records=["", "QMAC1 502 123 000456\n", "QMAC1 0501 123 000456\n", "QMAC1 501 0 000456\n", "QMAC1 501 18446744073709551616 000456\n", "QMAC1 501 123 1000000\n", "QMAC1 501 123 000456\n\n", "QMAC1 501 123 000456\nextra", "QMAC1 501 123 000456\nQMAC1 501 123 000456\n", "x".repeat(65), Buffer.from([0xd1,0x4d,0x41,0x43,0x31])]
  for(const text of records) {
    const f=fixture(),pending=f.owner.readIdentity(f.target);f.finish(undefined,text);assert.equal(await pending,null);assert.equal(f.owner.closed(),true)
  }
  for(const code of [1,64,65,66,67,255,null]) {
    const f=fixture(),pending=f.owner.readIdentity(f.target);f.finish(undefined,undefined,code);assert.equal(await pending,null)
  }
  const f=fixture(),pending=f.owner.readIdentity(f.target);f.helpers[0].stdout.emit("data",Buffer.alloc(65));f.finish();assert.equal(await pending,null)
  const g=fixture(),signaled=g.owner.readIdentity(g.target),h=g.helpers[0]
  h.stdout.emit("data",Buffer.from("QMAC1 501 123 000456\n"));h.emit("exit",0,"SIGTERM");h.emit("close",0,"SIGTERM")
  assert.equal(await signaled,null);assert.equal(g.owner.closed(),true)
})

test("only failed spawn with error and close can reconcile a helper without an established PID",async()=>{
  const f=fixture(),spawn=f.deps.spawn
  f.deps.spawn=(...args)=>{const c=spawn(...args);delete c.pid;return c}
  const owner=createDarwinIdentityReader(pins(),f.deps);owner.register(f.target)
  const pending=owner.readIdentity(f.target),c=f.helpers[0]
  c.emit("error",new Error("private raw error"));assert.equal(await pending,null);assert.equal(owner.closed(),false)
  c.emit("close",-1,null);assert.equal(owner.closed(),true);assert.equal(f.timers.size,0)
  const g=fixture(),p=g.owner.readIdentity(g.target);g.helpers[0].emit("error",new Error("raw"));g.helpers[0].emit("close",1,null)
  assert.equal(await p,null);assert.equal(g.owner.closed(),false);g.helpers[0].emit("exit",1,null);assert.equal(g.owner.closed(),true)
})

test("pin omissions, unsafe assets and changed assets refuse before helper spawn",async()=>{
  const f=fixture()
  for(const key of ["sourceSha256","buildManifestSha256","platformProfileSha256","nodeSha256","runId","lookupMs","cleanupMs"]) {
    const p=pins();delete p[key];assert.throws(()=>createDarwinIdentityReader(p,f.deps),/^Error: darwin-identity-pins-refused$/)
  }
  for(const override of [{readFile:()=>Buffer.from("changed")},{lstat:()=>{throw Error("missing")}}, {realpath:()=>"/other"},{arch:"x64"},{platform:"linux"}])assert.throws(()=>createDarwinIdentityReader(pins(),{...f.deps,...override}),/^Error: darwin-identity-pins-refused$/)
  assert.equal(f.calls.length,0)
  assert.throws(()=>createDarwinIdentityReader(pins(),{...f.deps,lstat:p=>p==="/private/owner"?{isDirectory:()=>true,mode:0o40777}:f.deps.lstat(p)}),/^Error: darwin-identity-pins-refused$/)
})

test("full uint64 seconds remain textual, chunking stays bounded, and registered PID changes revoke results",async()=>{
  const f=fixture(),pending=f.owner.readIdentity(f.target),c=f.helpers[0]
  for(const s of ["QMAC1 501 ","18446744073709551615 ","999999\n"])c.stdout.emit("data",Buffer.from(s))
  c.emit("exit",0,null);c.emit("close",0,null)
  assert.deepEqual(await pending,{pid:501,start:"darwin-bsd-v1:18446744073709551615:999999"})
  for(const value of [1,0,-1,2147483648,1.5,NaN,"501"]) {
    const g=fixture();g.target.pid=value;assert.equal(await g.owner.readIdentity(g.target),null);assert.equal(g.calls.length,0)
  }
  const g=fixture(),p=g.owner.readIdentity(g.target);g.target.pid=502;g.finish();assert.equal(await p,null)
})

test("spawn throw and immutable pin capture have no retry or unowned helper",async()=>{
  const f=fixture(),p=pins();let reads=bytes
  const owner=createDarwinIdentityReader(p,{...f.deps,readFile:()=>reads,spawn:()=>{throw Error("raw native failure")}});owner.register(f.target)
  p.helper.path="/changed";p.helper.sha256="e".repeat(64)
  assert.equal(await owner.readIdentity(f.target),null);assert.equal(owner.closed(),true);assert.equal(f.timers.size,0)
  const g=createDarwinIdentityReader(pins(),{...f.deps,readFile:()=>reads});g.register(f.target);reads=Buffer.from("changed")
  assert.equal(await g.readIdentity(f.target),null);assert.equal(f.calls.length,0)
})

test("late events from a reconciled helper cannot erase ownership of its successor",async()=>{
  const f=fixture(),first=f.owner.readIdentity(f.target),old=f.helpers[0];f.finish();await first
  const second=f.owner.readIdentity(f.target);old.emit("error",new Error("late"));old.emit("close",0,null)
  assert.equal(f.owner.closed(),false);assert.equal(f.owner.available(),false)
  assert.equal(await f.owner.readIdentity(f.target),null);assert.equal(f.helpers.length,2)
  f.finish();assert.deepEqual(await second,{pid:501,start:"darwin-bsd-v1:123:000456"});assert.equal(f.timers.size,0)
})
