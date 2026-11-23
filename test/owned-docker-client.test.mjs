import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createOwnedDockerClient } from "../src/run/owned-docker-client.mjs"
import { creationID } from "../src/run/container-receipt.mjs"

function setup() {
  let at = 0, next = 0
  const timers = new Map(), children = [], calls = []
  const clock = { now: () => at, set: (fn, ms) => { const id = ++next; timers.set(id, { fn, at: at + ms }); return id }, clear: id => timers.delete(id), tick() { const [id, t] = [...timers].sort((a,b) => a[1].at-b[1].at)[0]; timers.delete(id); at = t.at; t.fn() } }
  const spawn = (bin, args, options) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter(); child.stdin.end = () => {}
    child.signals = []; child.kill = signal => child.signals.push(signal)
    children.push(child); calls.push({ bin, args, options }); return child
  }
  const client = createOwnedDockerClient({ binary: "/pinned/docker", context: "colima-mem-evals-20261122", config: "/parent/docker", credentialValues: { OPENCODE_API_KEY: "synthetic-private-value" } }, { spawn, clock })
  return { client, children, calls, clock, timers }
}
const args = ["--context", "colima-mem-evals-20261122", "exec", "-e", "OPENCODE_API_KEY", "1".repeat(64), "node"]

test("direct Docker client requires exit AND close and never puts credential values in argv or returned output", async () => {
  const f = setup(), promise = f.client.run(args, { credentialNames: ["OPENCODE_API_KEY"], timeoutMs: 100, maxBytes: 1000 })
  const c = f.children[0]
  c.stdout.emit("data", Buffer.from("synthetic-private-value")); c.emit("exit", 0, null)
  assert.equal(f.client.closed(), false)
  c.emit("close", 0, null)
  const result = await promise
  assert.equal(result.closed, true)
  assert.equal(result.stdout.includes("synthetic-private-value"), false)
  assert.equal(f.calls[0].options.env.OPENCODE_API_KEY, "synthetic-private-value")
  assert.equal(JSON.stringify(f.calls[0].args).includes("synthetic-private-value"), false)
  assert.equal(f.calls[0].options.shell, false)
  assert.equal(f.calls[0].options.detached, false)
  assert.equal(f.client.closed(), true)
})

test("timeout/output overflow signal only original live handle and unknown closure remains tracked", async () => {
  for (const overflow of [false, true]) {
    const f = setup(), promise = f.client.run(args, { timeoutMs: 100, maxBytes: 4 })
    const c = f.children[0]
    if (overflow) c.stdout.emit("data", Buffer.from("too many bytes")); else f.clock.tick()
    f.clock.tick()
    const result = await promise
    assert.equal(result.closed, false)
    assert.equal(f.client.closed(), false)
    assert.deepEqual(c.signals, ["SIGTERM", "SIGKILL"])
    c.emit("exit", null, "SIGKILL"); c.emit("close", null, "SIGKILL")
    assert.equal(f.client.closed(), true)
    assert.equal(await f.client.stopClients(), true)
    assert.deepEqual(c.signals, ["SIGTERM", "SIGKILL"])
  }
})

test("creation authority rejects overflow, truncation and malformed fields but not unknown closure", () => {
  const receipt = { code: 0, stdout: "a".repeat(64) + "\n", overflow: false, closed: false }
  assert.equal(creationID(receipt), "a".repeat(64))
  assert.equal(creationID({ code: 0, stdout: receipt.stdout }), "a".repeat(64), "legacy complete response shape")
  for (const value of [null, {}, { stdout: receipt.stdout }, { code: 0 }, { ...receipt, code: "0" },
    ...[true, null, 0, "false"].map(overflow => ({ ...receipt, overflow })), { ...receipt, truncated: true }]) assert.equal(creationID(value), null)
})

const createArgs = ["--context", "colima-mem-evals-20261122", "network", "create", "--driver", "bridge", "evals-test-egress"]
test("stop drains synchronous and queued chunks, is idempotent, and respects the aggregate cap", async () => {
  for (const maxBytes of [128, 65]) {
    const f=setup(), pending=f.client.run(createArgs,{timeoutMs:100,maxBytes}),c=f.children[0]
    c.stdout.emit("data",Buffer.from("a".repeat(32)))
    c.kill=signal=>{c.signals.push(signal);c.stdout.emit("data",Buffer.from("a".repeat(32)+"\n"));return true}
    const first=f.client.stopClients(),second=f.client.stopClients()
    await Promise.resolve()
    c.stderr.emit("data",Buffer.from("queued"))
    c.emit("exit",0,null);c.emit("close",0,null)
    const result=await pending
    assert.equal(result.stdout,"a".repeat(64)+"\n")
    assert.equal(result.stderr,maxBytes===128?"queued":"")
    assert.equal(result.overflow,maxBytes===65)
    assert.equal(creationID(result),maxBytes===128?"a".repeat(64):null)
    assert.equal(await first,true);assert.equal(await second,true)
    assert.deepEqual(c.signals,["SIGTERM"])
    assert.equal(f.timers.size,0)
  }
})

test("a large output chunk retains only its bounded prefix and cannot become a receipt", async () => {
  const f=setup(),pending=f.client.run(createArgs,{timeoutMs:100,maxBytes:64}),c=f.children[0]
  c.stdout.emit("data",Buffer.from("a".repeat(64)+"invalid".repeat(10000)))
  c.emit("exit",0,null);c.emit("close",0,null)
  const result=await pending
  assert.equal(result.stdout,"a".repeat(64));assert.equal(result.overflow,true)
  assert.equal(creationID(result),null);assert.equal(result.code,0)
})

test("synchronous exit and close during stop clear every timer without changing the result later", async () => {
  const f=setup(),pending=f.client.run(createArgs,{timeoutMs:100,maxBytes:128}),c=f.children[0]
  c.kill=signal=>{c.signals.push(signal);c.stdout.emit("data",Buffer.from("a".repeat(64)));c.emit("exit",0,null);c.emit("close",0,null);return true}
  assert.equal(await f.client.stopClients(),true)
  const result=await pending,snapshot=JSON.stringify(result)
  assert.equal(result.stdout,"a".repeat(64));assert.equal(f.timers.size,0)
  c.stdout.emit("data",Buffer.alloc(1000));c.emit("exit",1,"SIGKILL");c.emit("close");c.emit("error",Error("private"))
  assert.equal(JSON.stringify(result),snapshot);assert.equal(f.timers.size,0)
})

test("exit, stream EOF and child close are separate; hung drain returns an immutable unknown", async () => {
  for (const closeFirst of [false,true]) {
    const f=setup(),pending=f.client.run(createArgs,{timeoutMs:100,maxBytes:128}),c=f.children[0]
    c.stdout.emit("data",Buffer.from("a".repeat(64)))
    c.stdout.emit("end");c.stderr.emit("end")
    if(closeFirst)c.emit("close");else c.emit("exit",0,null)
    assert.equal(f.client.closed(),false)
    f.clock.tick();f.clock.tick()
    const result=await pending,snapshot=JSON.stringify(result)
    assert.equal(result.closed,false)
    if(!closeFirst)assert.equal(creationID(result),"a".repeat(64))
    c.stdout.emit("data",Buffer.alloc(10000))
    if(closeFirst)c.emit("exit",0,null);else c.emit("close")
    assert.equal(await f.client.stopClients(),true)
    assert.equal(JSON.stringify(result),snapshot)
    assert.equal(f.timers.size,0)
  }
})

test("stream loss refuses receipt authority and observes late errors without exporting diagnostics", async () => {
  for(const loss of ["error","premature-close","data-after-end"]) {
    const f=setup(),pending=f.client.run(createArgs,{timeoutMs:100,maxBytes:128}),c=f.children[0]
    c.stdout.emit("data",Buffer.from("a".repeat(64)))
    if(loss==="error")c.stdout.emit("error",Error("private-stream-diagnostic"))
    if(loss==="premature-close")c.stderr.emit("close")
    if(loss==="data-after-end"){c.stderr.emit("end");c.stderr.emit("data",Buffer.from("late"))}
    c.emit("exit",0,null);c.emit("close")
    const result=await pending
    assert.equal(result.truncated,true,loss);assert.equal(creationID(result),null)
    assert.equal(JSON.stringify(result).includes("private-stream-diagnostic"),false)
    c.stdout.emit("error",Error("late-private"));c.stderr.emit("error",Error("late-private"))
    assert.equal(await f.client.stopClients(),true);assert.equal(f.timers.size,0)
  }
})

test("stdin and signal failures remain bounded, including unsupported asynchronous rejection", async () => {
  for(const mode of ["stdin-throw","stdin-error","kill-throw","kill-reject"]) {
    const f=setup(),spawn=(bin,a,options)=>{
      // Use the same fake ChildProcess shape; only its input and signal delivery differ.
      const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter()
      c.stdin.end=()=>{if(mode==="stdin-throw")throw Error("private-input");if(mode==="stdin-error")c.stdin.emit("error",Error("private-input"));return false}
      c.kill=()=>{if(mode==="kill-throw")throw Error("private-kill");if(mode==="kill-reject")return Promise.reject(Error("private-kill"));return false}
      f.children.push(c);return c
    }
    const client=createOwnedDockerClient({binary:"/pinned/docker",context:createArgs[1],config:"/parent/docker"},{spawn,clock:f.clock})
    const pending=client.run(args,{input:"bounded-input",timeoutMs:100,maxBytes:128})
    if(mode.startsWith("kill"))f.clock.tick()
    f.clock.tick()
    const result=await pending
    assert.equal(result.closed,false);assert.equal(client.closed(),false)
    await new Promise(setImmediate)
    const c=f.children[0];c.emit("exit",null,"SIGKILL");c.emit("close")
    assert.equal(await client.stopClients(),true);assert.equal(f.timers.size,0)
    assert.equal(JSON.stringify(result).includes("private-"),false)
  }
})

test("stdin backpressure does not resend input and split UTF-8 bytes decode only at settlement", async () => {
  const f=setup(),writes=[],child=new EventEmitter()
  child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>true
  child.stdin.end=input=>{writes.push(input);return false}
  const client=createOwnedDockerClient({binary:"/pinned/docker",context:createArgs[1],config:"/parent/docker"},{clock:f.clock,spawn:()=>child})
  const pending=client.run(createArgs,{input:"one bounded descriptor",timeoutMs:100,maxBytes:128})
  const bytes=Buffer.from("€\n")
  child.stdout.emit("data",bytes.subarray(0,1));child.stdin.emit("drain")
  const stopped=client.stopClients()
  child.stdout.emit("data",bytes.subarray(1));bytes.fill(0)
  child.stdout.emit("end");child.stderr.emit("end");child.emit("exit",0,null);child.emit("close")
  assert.equal((await pending).stdout,"€\n");assert.deepEqual(writes,["one bounded descriptor"])
  assert.equal(await stopped,true);assert.equal(f.timers.size,0)
})
