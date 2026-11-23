import assert from "node:assert/strict"
import * as fs from "node:fs"
import { join } from "node:path"
import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import { validateOwnedInputs } from "../../src/run/owned-io.mjs"

export const hash = bytes => createHash("sha256").update(bytes).digest("hex")
const id = n => n.toString(16).padStart(64,"0")
export function clock() {
  let time=0,sequence=0
  const timers=new Map()
  return {monotonic:()=>time,wall:()=>time,now:()=>time,set(fn,ms){const key=++sequence;timers.set(key,{fn,at:time+ms});return key},clear:key=>timers.delete(key),
    advance(ms){time+=ms},tick(){const [key,v]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]??[];assert.ok(v,"finite timer available");timers.delete(key);time=Math.max(time,v.at);v.fn()},pending:()=>timers.size}
}
export async function drive(promise,c) {
  let done=false,value,error
  promise.then(v=>{value=v;done=true},e=>{error=e;done=true})
  for(let i=0;i<2000&&!done;i++){for(let j=0;j<300;j++)await Promise.resolve();if(!done)c.tick()}
  assert.equal(done,true,"bounded parent settlement");if(error)throw error;return value
}
export function containedFixture(f,hooks={}) {
  const c=clock(),resources=new Map(),calls=[],descriptors=[],children=new Set(),fdPaths=new Map(),finalReads=[]
  const inputs=join(f.root,"inputs"),binaries=join(f.root,"binaries"),work=join(f.root,"work")
  for(const p of [inputs,binaries,work,...["harness","arm","cases"].map(p=>join(inputs,p))])fs.mkdirSync(p)
  for(const name of ["caps.json","models.json","model-map.json","conditions.json"])fs.writeFileSync(join(inputs,name),"{}")
  fs.writeFileSync(join(inputs,"harness","identity"),"synthetic harness")
  fs.writeFileSync(join(inputs,"cases","core-a.json"),"{}")
  const elf=Buffer.alloc(20);elf.write("\x7fELF");elf[4]=2;elf[5]=1;elf.writeUInt16LE(183,18)
  for(const name of ["node","opencode"])fs.writeFileSync(join(binaries,name),elf,{mode:0o700})
  const snapshot={inputs,binaries,work,architecture:"arm64",image:f.wave.runtime.image,imageEnv:["PATH=/usr/bin:/bin"],user:"1000:1000",allow:["opencode.ai"]}
  const digests=validateOwnedInputs({...snapshot,descriptor:{options:{condition:"direct"}}})
  Object.assign(snapshot,{inputs_sha256:digests.inputs_sha256,binaries_sha256:digests.binaries_sha256})
  const journal=()=>JSON.parse(fs.readFileSync(join(hooks.journalDirectory?.() ?? join(f.wave.control,"resources"),"first.json"),"utf8"))
  const values=(a,key)=>a.flatMap((v,i)=>v===key?[a[i+1]]:[]),value=(a,key)=>values(a,key)[0]
  let sequence=0
  function response(a,options,input) {
    const ok=(stdout="")=>({code:0,stdout,stderr:""})
    if(a[0]==="network"&&a[1]==="create"||a[0]==="create") {
      assert.equal(fs.existsSync(join(hooks.journalDirectory?.() ?? join(f.wave.control,"resources"),"first.started.json")),true,"started marker before creation")
      assert.ok(journal().pending.length,"pending journal before create")
      const target=id(++sequence)
      if(a[0]==="network")resources.set(target,{Id:target,Driver:value(a,"--driver"),Internal:a.includes("--internal"),Options:Object.fromEntries(values(a,"-o").map(s=>s.split("=")))})
      else {
        const mounts=values(a,"--mount").map(text=>{const m=Object.fromEntries(text.split(",").map(s=>s.split("=")));return {Type:m.type,Source:m.src,Destination:m.dst,RW:!text.endsWith(",readonly"),Propagation:"rprivate"}})
        resources.set(target,{Id:target,Image:snapshot.image,Config:{User:value(a,"--user"),Env:[...snapshot.imageEnv,...values(a,"-e")],Entrypoint:["/usr/bin/tini","--"],Cmd:a.slice(a.indexOf(snapshot.image)+1),WorkingDir:value(a,"--workdir")},
          HostConfig:{Privileged:false,ReadonlyRootfs:a.includes("--read-only"),NetworkMode:value(a,"--network"),CapDrop:values(a,"--cap-drop"),SecurityOpt:values(a,"--security-opt"),Memory:+value(a,"--memory"),MemorySwap:+value(a,"--memory-swap"),NanoCpus:+value(a,"--cpus")*1e9,PidsLimit:+value(a,"--pids-limit"),Tmpfs:Object.fromEntries(values(a,"--tmpfs").map(s=>[s.slice(0,s.indexOf(":")),s.slice(s.indexOf(":")+1)])),LogConfig:{Type:value(a,"--log-driver"),Config:Object.fromEntries(values(a,"--log-opt").map(s=>s.split("=")))}},Mounts:mounts,NetworkSettings:{Networks:{first:{NetworkID:value(a,"--network")}}},State:{Running:false,Status:"created"}})
      }
      return ok(target)
    }
    if(a[0]==="inspect"||a[0]==="network"&&a[1]==="inspect") {
      if(resources.has(a.at(-1)))assert.ok(journal().resources.some(r=>r.id===a.at(-1)),"full receipt before activation inspect")
      return resources.has(a.at(-1))?ok(JSON.stringify([resources.get(a.at(-1))])):{code:1,stdout:"",stderr:`Error: No such object: ${a.at(-1)}`}
    }
    if(a[0]==="network"&&a[1]==="connect"){resources.get(a.at(-1)).NetworkSettings.Networks.second={NetworkID:a.at(-2)};return ok()}
    if(a[0]==="start"){assert.ok(journal().resources.some(r=>r.id===a[1]));resources.get(a[1]).State={Running:true,Status:"running"};return ok()}
    if(a[0]==="logs")return ok('{"ev":"listening"}')
    if(a[0]==="exec") {
      const d=JSON.parse(input);descriptors.push(d)
      assert.equal(journal().config_proof.launch_sha256,hash(input),"descriptor durably bound before exec")
      const raw=Buffer.from(JSON.stringify({type:"step_finish",part:{cost:0.25}})+"\n")
      fs.writeFileSync(join(work,"raw.jsonl"),raw)
      fs.writeFileSync(join(work,"provisional.json"),JSON.stringify({schema:"oc-owned-provisional/1",complete:false,overflow:false,streams_closed:true,binding:d.binding,container_id:d.container_id,launch_sha256:hash(input),exit:0,evidence:[{path:"raw.jsonl",bytes:raw.length,sha256:hash(raw)}]}))
      return {...ok(),code:1}
    }
    if(a[0]==="rm"||a[0]==="network"&&a[1]==="rm"){resources.delete(a.at(-1));return ok()}
    if(a[0]==="stop")return ok()
    assert.fail(`unexpected Docker command ${a[0]}`)
  }
  const owned={snapshot:request=>({...snapshot,manifest_sha256:request.manifestSha,harness_sha:f.wave.harness_sha,trial_id:request.trial.id}),measure:()=>true,
    io:{...fs,openSync(path,...args){const fd=fs.openSync(path,...args);fdPaths.set(fd,path);return fd},readFileSync(fd,...args){if(fdPaths.get(fd)?.startsWith(work+"/")){assert.equal(resources.size,0,"no postmortem read with live resources");assert.equal(children.size,0,"no postmortem read with unclosed clients");finalReads.push(fdPaths.get(fd))}return fs.readFileSync(fd,...args)},closeSync(fd){fdPaths.delete(fd);fs.closeSync(fd)}},
    spawn(binary,args,options){
      assert.equal(binary,"/pinned/docker");assert.deepEqual(args.slice(0,2),["--context","colima-mem-evals-20261122"])
      const a=args.slice(2);calls.push(a)
      const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();children.add(child)
      const settle=(r,close=true)=>{child.stdout.emit("data",Buffer.from(r.stdout??""));child.stderr.emit("data",Buffer.from(r.stderr??""));child.emit("exit",r.code,null);if(close){children.delete(child);child.emit("close",r.code,null)}}
      // ChildProcess.kill returns before Node delivers exit/stdio-close events.
      child.kill=()=>{queueMicrotask(()=>settle({code:null}));return true}
      const run=input=>queueMicrotask(()=>{const r=response(a,options,input);if(hooks.reply)hooks.reply({a,r,settle,child,resources,c,work,journal});else settle(r)})
      if(options.stdio[0]==="pipe")child.stdin.end=run;else run(null)
      return child
    }}
  return {owned,c,resources,calls,descriptors,journal,snapshot,work,finalReads,children}
}
