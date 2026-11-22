import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createNativeObserver } from '../src/run/mem-observer/observer.mjs'
import { decodeNativeRaw } from '../src/run/mem-observer/raw-2.2.6.mjs'
import { projectEnteredScope } from '../src/run/mem-observer/projection.mjs'
import { controls,domain,scope,schema } from './support/mem-observer.mjs'

async function recorded(caseName) {
  const raw=decodeNativeRaw(readFileSync(new URL(`./fixtures/mem-observer-2.2.6/${caseName}.raw.txt`,import.meta.url)),{version:'2.2.6'})
  const carrier=raw.carriers[0],id=caseName==='direct'?'probe_recall':'probe_inner'
  const actualScope={...scope,sessionID:carrier.native.sessionID}
  let execution=0
  const host=domain(async()=>({content:`synthetic:${caseName==='direct'?'direct':'identical'}:effect-${++execution}`}),id)
  const ctl=controls({inventory:[{id,input:schema,options:{codemode:true}}],
    qualifyInventory:async({inventoryHash})=>({generation:'g',inventoryHash,promiseTools:[id],auditFirst:true,transformsFinal:true,textOnly:true}),
    verifyAuthority:async()=>({scope:actualScope,generation:'g',quiescent:true}),
  })
  const observer=createNativeObserver(ctl.options)
  await observer.install(host.api);await observer.ready();await observer.open(ctl.openProof)
  const input=caseName==='direct'?carrier.input:{query:'identical',mode:'ok'}
  await host.dispatch(input,carrier.native)
  if(caseName!=='direct')await host.dispatch(input,carrier.native)
  const observation=await observer.seal(ctl.sealProof)
  return {observer,observation,raw}
}

test('private projection reconciles actual direct raw text without forging callID or existing sidecars',async()=>{
  const {observer,observation,raw}=await recorded('direct')
  const projected=projectEnteredScope({observation,raw})
  assert.equal(projected.schema,'private-native-entered-projection/1')
  assert.equal(projected.coverage,'entered-executor')
  assert.deepEqual(projected.issues,[])
  assert.equal(projected.status,'sealed')
  assert.equal(Object.hasOwn(projected,'complete'),false)
  assert.equal(projected.occurrenceOrder[0].route,'direct')
  assert.deepEqual(projected.occurrenceOrder[0].native,raw.carriers[0].native)
  assert.equal(projected.occurrenceOrder[0].text,'synthetic:direct:effect-1')
  assert.equal(Object.hasOwn(projected.occurrenceOrder[0],'callID'),false)
  assert.equal(projected.rawSha256,raw.sha256)
  await observer.close()
})

test('inner occurrence order and carrier terminal order remain separate; no outer return creates calls',async()=>{
  const {observer,observation,raw}=await recorded('sequential')
  const projected=projectEnteredScope({observation,raw})
  assert.equal(projected.occurrenceOrder.length,2)
  assert.equal(projected.carrierTerminalOrder.length,1)
  assert.deepEqual(projected.occurrenceOrder.map(c=>c.route),['inner','inner'])
  assert.notEqual(projected.occurrenceOrder[0].observerOccurrence,projected.occurrenceOrder[1].observerOccurrence)
  const absent=structuredClone(observation);absent.occurrences=[]
  assert.equal(projectEnteredScope({observation:absent,raw}).occurrenceOrder.length,0)
  const missing={...raw,carriers:[]}
  assert.equal(projectEnteredScope({observation,raw:missing}).status,'partial')
  const altered=structuredClone(observation);altered.occurrences[0].native.messageID='foreign'
  assert.equal(projectEnteredScope({observation:altered,raw}).status,'partial')
  await observer.close()
})

test('raw truncation, direct mismatch, observer unhealthy, and unknown version remain partial',async()=>{
  const {observer,observation,raw}=await recorded('direct')
  for(const mutate of [p=>p.occurrences[0].input.value.query='different',p=>p.occurrences[0].result.value.content='different',p=>p.health.ok=false,p=>p.pending=1,p=>p.version='future']) {
    const bad=structuredClone(observation);mutate(bad)
    assert.equal(projectEnteredScope({observation:bad,raw}).status,'partial')
  }
  assert.equal(projectEnteredScope({observation,raw:{...raw,issues:['truncated-output']}}).status,'partial')
  await observer.close()
})

test('a native terminal for an inventoried tool cannot certify an absent executor occurrence',async()=>{
  const {observer,observation,raw}=await recorded('direct')
  const absent=structuredClone(observation)
  absent.occurrences=[]
  const projected=projectEnteredScope({observation:absent,raw})
  assert.equal(projected.status,'partial')
  assert.ok(projected.issues.includes('missing-observer-occurrence'))
  assert.equal(projected.occurrenceOrder.length,0)
  await observer.close()
})

test('zero entered projection still needs the actual native session finish, not an empty raw file',async()=>{
  const bytes=readFileSync(new URL('./fixtures/mem-observer-2.2.6/zero.raw.txt',import.meta.url))
  const events=bytes.toString().trim().split('\n').map(JSON.parse)
  const actualScope={...scope,sessionID:events[0].sessionID}
  const ctl=controls({verifyAuthority:async()=>({scope:actualScope,generation:'generation-one',quiescent:true})})
  const observer=createNativeObserver(ctl.options),host=domain(async()=>({content:'unused'}))
  await observer.install(host.api);await observer.ready();await observer.open(ctl.openProof)
  const observation=await observer.seal(ctl.sealProof)
  assert.equal(projectEnteredScope({observation,raw:decodeNativeRaw(bytes,{version:'2.2.6'})}).status,'sealed')
  assert.equal(projectEnteredScope({observation,raw:decodeNativeRaw(Buffer.alloc(0),{version:'2.2.6'})}).status,'partial')
  await observer.close()
})

test('different outer carriers retain reverse terminal order independently of occurrence order',async()=>{
  const {observer,observation,raw}=await recorded('direct')
  // Synthetic transport variation derived from the retained raw fixture, not a host run.
  const events=raw.rawBytes.toString().trim().split('\n').map(JSON.parse)
  const terminal=structuredClone(events.find(e=>e.type==='tool_use'))
  terminal.part.id='second-carrier';terminal.part.partID='second-part'
  const changed=decodeNativeRaw(Buffer.from([terminal,...events].map(JSON.stringify).join('\n')+'\n'),{version:'2.2.6'})
  const copy=structuredClone(observation)
  copy.occurrences.push({...structuredClone(copy.occurrences[0]),order:2,observerOccurrence:'observer-second',native:{...copy.occurrences[0].native,id:'second-carrier'}})
  const projected=projectEnteredScope({observation:copy,raw:changed})
  assert.deepEqual(projected.occurrenceOrder.map(o=>o.native.id),['owned_direct_carrier','second-carrier'])
  assert.deepEqual(projected.carrierTerminalOrder.map(c=>c.native.id),['second-carrier','owned_direct_carrier'])
  await observer.close()
})

test('zero-entry audited outer carriers each require a terminal, independent of audit or transport order',async()=>{
  const bytes=readFileSync(new URL('./fixtures/mem-observer-2.2.6/schema.raw.txt',import.meta.url))
  const rows=bytes.toString().trim().split('\n').map(JSON.parse)
  const terminal=rows.find(row=>row.type==='tool_use'),second=structuredClone(terminal)
  second.part.id='second-outer';second.part.partID='second-part'
  const bound={...scope,sessionID:terminal.sessionID}
  const ctl=controls({verifyAuthority:async()=>({scope:bound,generation:'generation-one',quiescent:true})})
  const host=domain(async()=>{throw new Error('must not enter')}),observer=createNativeObserver(ctl.options)
  await observer.install(host.api);await observer.ready();await observer.open(ctl.openProof)
  for(const row of [terminal,second])for(const hook of host.hooks.before)await hook({...row.part,tool:'execute',input:{code:'opaque'}})
  for(const row of [second,terminal])for(const hook of host.hooks.after)await hook({...row.part,tool:'execute',input:{code:'opaque'},status:'completed',result:{content:'ok'}})
  const observation=await observer.seal(ctl.sealProof)
  assert.equal(observation.enteredScopeSealed,true)
  assert.equal(observation.occurrences.length,0)
  const project=events=>projectEnteredScope({observation,raw:decodeNativeRaw(Buffer.from(events.map(JSON.stringify).join('\n')+'\n'),{version:'2.2.6'})})
  assert.equal(project([second,...rows]).status,'sealed')
  for(const events of [rows,rows.filter(row=>row.type!=='tool_use')]) {
    const partial=project(events)
    assert.equal(partial.status,'partial')
    assert.ok(partial.issues.includes('missing-audited-native-terminal'))
    assert.equal(partial.occurrenceOrder.length,0)
    assert.equal(partial.audit.length,4)
  }
  const failed=structuredClone(second);failed.part.state={input:{},status:'error',error:'cancelled'}
  assert.equal(project([failed,...rows]).status,'partial')
  await observer.close()
})

test('zero handshake rejects mixed non-tool sessions, malformed stops, and truncated or unknown events',async()=>{
  const bytes=readFileSync(new URL('./fixtures/mem-observer-2.2.6/zero.raw.txt',import.meta.url))
  const cancel=readFileSync(new URL('./fixtures/mem-observer-2.2.6/cancel.raw.txt',import.meta.url))
  const rows=bytes.toString().trim().split('\n').map(JSON.parse),bound={...scope,sessionID:rows[0].sessionID}
  const ctl=controls({verifyAuthority:async()=>({scope:bound,generation:'generation-one',quiescent:true})})
  const observer=createNativeObserver(ctl.options),host=domain(async()=>({content:'unused'}))
  await observer.install(host.api);await observer.ready();await observer.open(ctl.openProof)
  const observation=await observer.seal(ctl.sealProof)
  const project=buffer=>projectEnteredScope({observation,raw:decodeNativeRaw(buffer,{version:'2.2.6'})})
  assert.equal(project(bytes).status,'sealed')
  assert.equal(project(Buffer.concat([bytes,cancel])).status,'partial')
  for(const row of rows) {
    const foreign=structuredClone(row);foreign.sessionID='foreign';foreign.part.sessionID='foreign'
    assert.equal(project(Buffer.concat([bytes,Buffer.from(JSON.stringify(foreign)+'\n')])).status,'partial',row.type)
    const disagreement=structuredClone(row);disagreement.part.sessionID='foreign'
    assert.equal(project(Buffer.concat([bytes,Buffer.from(JSON.stringify(disagreement)+'\n')])).status,'partial',row.type)
  }
  for(const tail of ['{"type":"text"','{"type":"unknown"}\n'])assert.equal(project(Buffer.concat([bytes,Buffer.from(tail)])).status,'partial')
  const malformed={type:'step_finish',sessionID:bound.sessionID,part:{reason:'stop',sessionID:bound.sessionID}}
  assert.equal(project(Buffer.from(JSON.stringify(malformed)+'\n')).status,'partial')
  await observer.close()
})
