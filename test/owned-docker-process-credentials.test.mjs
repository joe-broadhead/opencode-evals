import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createOwnedDockerProcess } from "../src/run/owned-docker-process.mjs"
import { createOwnedDockerClient } from "../src/run/owned-docker-client.mjs"
import { containTrial } from "../src/run/owned-containment.mjs"

const context="colima-mem-evals-20261122",binary="/pinned/docker",config="/parent/docker"
function plan() {
  return {context,dockerConfig:config,binding:{invocation_id:"11111111-1111-4111-8111-111111111111",manifest_sha256:"a".repeat(64),trial_id:"credential-case"},image:`sha256:${"b".repeat(64)}`,imageEnv:["PATH=/usr/bin:/bin"],user:"1000:1000",control:"/parent/control",store:"/parent/store",work:"/staged/work",inputs:"/staged/inputs",binaries:"/staged/bin",inputs_sha256:"c".repeat(64),binaries_sha256:"d".repeat(64),allow:["opencode.ai"],credentialNames:["OPENCODE_API_KEY"],timeoutMs:1000,cleanupMs:1000,operationMs:100,outputBytes:4096,
    descriptor:{options:{plugin:"mem",iteration:"trial-a",model:"opencode/deepseek-v4.1-flash#low",auth:"env:OPENCODE_API_KEY",cases:"case-a",casesDir:"/inputs/cases",set:"set-a",trials:1,parallel:1,arm:"/inputs/arm",world:"/inputs/harness/worlds/mem/index.mjs",host:"2.2.6",timeout:1,stale:"refuse",tools:"locked",isolation:"owned-container",harnessRetries:0,processGroup:"inherited",condition:"direct"}}}
}
const owner=()=>({binary,config,context,plan:plan(),credentialValues:{OPENCODE_API_KEY:"synthetic-credential"}})

test("credential contract refuses renamed keys, auth mismatch and multiple mappings before any effects",async()=>{
  const variants=[]
  for(const name of ["DYLD_INSERT_LIBRARIES","DYLD_LIBRARY_PATH","LD_PRELOAD","NODE_OPTIONS","DOCKER_HOST","SSH_AUTH_SOCK","SAFE_KEY"]) {
    const o=owner();o.plan.credentialNames=[name];o.plan.descriptor.options.auth=`env:${name}`;o.credentialValues={[name]:"synthetic-credential"};variants.push(o)
  }
  const mismatch=owner();mismatch.plan.descriptor.options.auth="env:SAFE_KEY";variants.push(mismatch)
  const multiple=owner();multiple.plan.credentialNames.push("SAFE_KEY");multiple.credentialValues.SAFE_KEY="synthetic-extra";variants.push(multiple)
  const extra=owner();extra.credentialValues.SAFE_KEY="synthetic-extra";variants.push(extra)
  const missing=owner();missing.credentialValues={};variants.push(missing)
  const duplicate=owner();duplicate.plan.credentialNames.push("OPENCODE_API_KEY");variants.push(duplicate)
  for(const o of variants) {
    const effects={spawn:0,identity:0,readFile:0,input:0,queued:0}
    const deps={platform:"linux",readIdentity:()=>{effects.identity++;return null},readFile:()=>{effects.readFile++;return ""},spawn:()=>{
      effects.spawn++;queueMicrotask(()=>effects.queued++)
      return {stdin:{end(){effects.input++}}}
    }}
    assert.throws(()=>createOwnedDockerProcess(o,deps),error=>error.message==="owned-docker-credential-refused")
    await new Promise(setImmediate)
    assert.deepEqual(effects,{spawn:0,identity:0,readFile:0,input:0,queued:0})
  }
})

test("canonical credential and captured pins retain the actual containment client adapter schedule",async()=>{
  const o=owner(),p=structuredClone(o.plan),calls=[],resources=new Set(),timers=new Map();let next=0,timer=0,identities=0,inputs=0
  const clock={now:()=>0,set(fn,ms){timers.set(++timer,{fn,ms});return timer},clear:id=>timers.delete(id)}
  const transport=createOwnedDockerProcess(o,{readIdentity:c=>{identities++;return {pid:c.pid,start:"birth"}},readFile:()=>assert.fail("no filesystem identity"),spawn:(file,args,options)=>{
    const c=new EventEmitter();c.pid=100+calls.length;c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.stdin.writableFinished=false
    c.stdin.end=(bytes,done)=>{inputs++;assert.equal(JSON.parse(bytes).context,context);c.stdin.writableFinished=true;c.stdin.emit("finish");done?.();return c.stdin}
    c.kill=()=>assert.fail("healthy schedule must not signal");calls.push({file,args,options})
    queueMicrotask(()=>{
      c.emit("spawn");const a=args.slice(2);let out="",err="",code=0
      if(a[0]==="create"||a[0]==="network"&&a[1]==="create"){out=String(++next).padStart(64,"0");resources.add(out)}
      else if(a[0]==="rm"||a[0]==="network"&&a[1]==="rm")resources.delete(a.at(-1))
      else if(a[0]==="inspect"||a[0]==="network"&&a[1]==="inspect") {if(resources.has(a.at(-1)))out="[{}]";else{code=1;err=`Error: No such object: ${a.at(-1)}\n`}}
      else if(a[0]==="logs")out='{"ev":"listening"}\n'
      c.stdout.emit("data",Buffer.from(out));c.stderr.emit("data",Buffer.from(err));c.emit("exit",code,null);c.emit("close",code,null)
    });return c
  }})
  const client=createOwnedDockerClient({binary,config,context,credentialValues:{...o.credentialValues}},{spawn:transport.spawn,clock,graceMs:10})
  o.plan.credentialNames[0]="SAFE_KEY";o.plan.descriptor.options.auth="env:SAFE_KEY";o.credentialValues.OPENCODE_API_KEY="changed"
  let done=false
  const pending=containTrial(p,{docker:client,clock,journal:async()=>{},validateInputs:async()=>({work:{dev:1,ino:2},inputs_sha256:p.inputs_sha256,binaries_sha256:p.binaries_sha256}),measure:async()=>true,inspectConfig:()=>true,finalize:async()=>({})})
  pending.then(()=>done=true)
  for(let i=0;i<3000&&!done;i++)await Promise.resolve()
  assert.equal(done,true);const result=await pending
  assert.equal(result.cleanup_verified,true);assert.equal(result.complete,false);assert.equal(result.successor_allowed,false)
  assert.equal(resources.size,0);assert.equal(inputs,1);assert.equal(identities,calls.length);assert.equal(timers.size,0)
  const exec=calls.find(c=>c.args[2]==="exec");assert.ok(exec)
  assert.equal(exec.options.env.OPENCODE_API_KEY,"synthetic-credential");assert.equal(exec.args.includes("synthetic-credential"),false)
  assert.equal(exec.options.env.SAFE_KEY,undefined);assert.equal(exec.options.env.DYLD_INSERT_LIBRARIES,undefined)
  assert.ok(calls.every(c=>c.file===binary&&c.args[1]===context&&c.options.shell===false&&c.options.detached===false))
  assert.equal(transport.qualified,false);assert.equal(client.closed(),true)
  assert.throws(()=>client.run(["--context",context,"inspect","a".repeat(64)],{env:{SAFE_KEY:"synthetic"},timeoutMs:100,maxBytes:128}),/refused/)
  assert.equal(identities,calls.length)
})
