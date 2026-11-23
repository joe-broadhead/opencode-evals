import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { makeCompletionReadClient } from '../src/run/native-completion-http.mjs';
import { verifyNativeCompletion } from '../src/run/native-completion.mjs';

const bytes = (s) => new TextEncoder().encode(s);
const binding = { caseID:'case',trialID:'trial',turnID:'turn',activationID:'activation',
  incarnationID:'incarnation',sessionID:'ses_root',scope:{complete:true,serial:true,sessionIDs:['ses_root']} };
const opts = () => ({signal:new AbortController().signal,maxBytes:4194304});
const tick = () => new Promise(resolve => setImmediate(resolve));
function body(chunks=[], config={}) {
  let pending, cancelled=false;
  const stats={reads:0,cancels:0,releases:0};
  const reader={
    read() { stats.reads++; if(chunks.length) return Promise.resolve({done:false,value:chunks.shift()});
      if(config.open && !cancelled) return new Promise((resolve,reject)=>{pending={resolve,reject};});
      return Promise.resolve({done:true}); },
    cancel() { stats.cancels++; cancelled=true; pending?.resolve({done:true}); pending=undefined; return Promise.resolve(); },
    releaseLock() {stats.releases++;},
  };
  return {stats, reader, getReader:()=>reader, cancel:()=>reader.cancel(),
    emit(value) { assert.ok(pending); const p=pending;pending=undefined;p.resolve({done:false,value}); } };
}
function response(value, status=200, media='application/json') {
  const stream=body(value===undefined?[]:[bytes(JSON.stringify(value))]);
  return {status,headers:new Headers({'content-type':media}),body:stream,stream};
}
function fixture(fetcher, changes={}) {
  const revoke=new AbortController(), calls=[], resources=new Set();
  const endpointLease={origin:'http://127.0.0.1:43123',authorization:'Basic b3BlbmNvZGU6dGVzdA==',
    sessionIDs:['ses_root'],incarnationID:'incarnation',signal:revoke.signal,limits:{closeMs:50},...changes};
  const transportOwner={track(resource) {resources.add(resource);return ()=>resources.delete(resource);}};
  const client=makeCompletionReadClient({endpointLease,binding,transportOwner,
    fetchImpl:(url,init)=>{calls.push({url,init});return fetcher(url,init);}});
  return {client,calls,resources,revoke,endpointLease};
}
test('finite read seam emits only the five native routes and preserves envelopes',async()=>{
  const page={data:[],cursor:{previous:'opaque/+=',next:'opaque?&'}}, active={ses_foreign:{type:'running'}};
  const results=[response(page),response({data:[]}),response({data:[]}),response({data:active}),response(undefined,204)];
  const f=fixture(()=>results.shift());
  assert.deepEqual(await f.client.message.list({sessionID:'ses_root',limit:200,order:'desc'},opts()),page);
  assert.deepEqual(await f.client.experimental.job.list({sessionID:'ses_root',descendants:true},opts()),[]);
  assert.deepEqual(await f.client.session.inbox.list({sessionID:'ses_root'},opts()),[]);
  assert.deepEqual(await f.client.session.active(undefined,opts()),active);
  assert.equal(await f.client.experimental.session.wait({sessionID:'ses_root'},opts()),undefined);
  assert.deepEqual(f.calls.map(({url,init})=>[url,init.method]),[
    ['http://127.0.0.1:43123/api/session/ses_root/message?limit=200&order=desc','GET'],
    ['http://127.0.0.1:43123/api/experimental/job?sessionID=ses_root&descendants=true','GET'],
    ['http://127.0.0.1:43123/api/session/ses_root/inbox','GET'],
    ['http://127.0.0.1:43123/api/session/active','GET'],
    ['http://127.0.0.1:43123/api/experimental/session/ses_root/wait','POST'],
  ]);
  for(const {init} of f.calls) {
    assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.body,undefined);
    assert.deepEqual(init.headers,{Authorization:'Basic b3BlbmNvZGU6dGVzdA==',Accept:'application/json'});
  }
  assert.equal(f.resources.size,0);
  assert.deepEqual(Object.keys(f.client).sort(),['event','experimental','message','session']);
  assert.deepEqual(Object.keys(f.client.session).sort(),['active','inbox']);
});

test('lease snapshot, strict arguments, opaque cursors and live revocation precede every fetch',async()=>{
  const f=fixture(()=>response({data:[],cursor:{}}));
  f.endpointLease.origin='http://remote.invalid';f.endpointLease.authorization='evil';f.endpointLease.sessionIDs.push('foreign');
  await f.client.message.list({sessionID:'ses_root',limit:200,cursor:'a/?+ &='},opts());
  assert.equal(f.calls[0].url,'http://127.0.0.1:43123/api/session/ses_root/message?limit=200&cursor=a%2F%3F%2B+%26%3D');
  for(const input of [{sessionID:'foreign',limit:200,order:'desc'},
    {sessionID:'ses_root',limit:200,order:'desc',cursor:'x'},
    {sessionID:'ses_root',limit:199,order:'desc'}, {sessionID:'ses_root',limit:200,order:'asc'},
    {sessionID:'ses_root',limit:200,order:'desc',headers:{X:'bad'}}])
    await assert.rejects(f.client.message.list(input,opts()));
  await assert.rejects(f.client.session.active(undefined,{...opts(),headers:{Authorization:'bad'}}));
  const c=new AbortController();c.abort();
  await assert.rejects(f.client.session.active(undefined,{signal:c.signal}),/read_aborted/);
  f.revoke.abort();await assert.rejects(f.client.session.active(undefined,opts()),/read_aborted/);
  assert.equal(f.calls.length,1);
  for(const origin of ['http://localhost:123','http://127.1:123','http://2130706433:123',
    'http://127.0.0.1:123/','http://127.0.0.1:123?x','http://user@127.0.0.1:123','https://127.0.0.1:123',
    'http://127.0.0.1:65536','http://127.0.0.1:0']) assert.throws(()=>fixture(()=>{}, {origin}),/invalid_endpoint_lease/);
});

test('success and error bodies obey byte, media, UTF-8 and envelope checks',async(t)=>{
  for(const [name,make,options,code] of [
    ['streamed success',()=>response({data:[]}),{maxBytes:1},'response_byte_limit'],
    ['streamed error',()=>response({secret:'not an error message'},401),{maxBytes:1},'response_byte_limit'],
    ['length hint',()=>{const r=response({data:[]});r.headers.set('content-length','999');return r;},{maxBytes:20},'response_byte_limit'],
    ['media',()=>response({data:[]},200,'text/html'),{},'unsupported_content_type'],
    ['UTF-8',()=>({...response({}),body:body([new Uint8Array([0xff])])}),{},'invalid_utf8'],
    ['JSON',()=>({...response({}),body:body([bytes('{')])}),{},'invalid_json'],
    ['envelope',()=>response({data:{data:[]}}),{},'invalid_wire_shape'],
    ['finite',()=>({...response({}),body:body([bytes('{"data":[],"extra":1e999}')])}),{},'invalid_wire_shape'],
  ]) await t.test(name,async()=>{
    const r=make(),f=fixture(()=>r);
    await assert.rejects(f.client.experimental.job.list({sessionID:'ses_root',descendants:true},options),{message:code});
    assert.equal(f.resources.size,0);assert.equal(r.body.stats.releases,1);
  });
  for(const status of [301,302,400,401,404,500,503,201,418]) {
    const f=fixture(()=>response({message:'secret remote text'},status));
    await assert.rejects(f.client.session.active(undefined,opts()),{message:`http_status_${status}`});
  }
  const f=fixture(()=>response({bad:true},204));
  await assert.rejects(f.client.experimental.session.wait({sessionID:'ses_root'},opts()),/unexpected_response_body/);
});

test('finite abort joins headers/body cancellation, bounded failure retains exact unresolved ownership',async()=>{
  for(const at of ['headers','body']) {
    const caller=new AbortController();let resolveHeaders;
    const r=response({});r.body=body([],{open:true});
    const f=fixture(()=>at==='headers'?new Promise(resolve=>{resolveHeaders=resolve;}):r);
    const p=f.client.session.active(undefined,{signal:caller.signal});const check=assert.rejects(p,/read_aborted/);
    await tick();caller.abort();if(resolveHeaders) resolveHeaders(r);
    await check;assert.equal(r.body.stats.cancels,1);assert.equal(r.body.stats.releases,1);assert.equal(f.resources.size,0);
  }
  let resolveHeaders;
  const f=fixture(()=>new Promise(resolve=>{resolveHeaders=resolve;}),{limits:{closeMs:10}});
  const p=f.client.session.active(undefined,opts());const check=assert.rejects(p,/transport_teardown_failed/);
  await tick();f.revoke.abort();await check;
  assert.equal(f.resources.size,1);
  const r=response({data:{}});resolveHeaders(r);await tick();
  assert.equal(r.body.stats.cancels,1);assert.equal(r.body.stats.releases,1);assert.equal(f.resources.size,0);
});

const connected={id:'evt_connect',type:'server.connected',data:{}};
const event=(type='session.execution.failed',id='evt_failure',data={sessionID:'ses_root',error:{type:'test',message:'failure'}})=>
  ({id,type,created:7,data,durable:{aggregateID:data.sessionID,seq:2,version:1}});
const frame=e=>`data: ${JSON.stringify(e)}\n\n`;
function streamFixture(chunks,changes={}) {
  const stream=body(chunks,{open:true});
  const f=fixture(()=>({status:200,headers:new Headers({'content-type':'text/event-stream'}),body:stream}),changes);
  return {...f,stream};
}
test('synchronous event iterator seals without clearing queued or resolved prefix',async()=>{
  const negative=event(),f=streamFixture([bytes(frame(connected)+frame(negative))]);
  const iterable=f.client.event.subscribe(opts());assert.equal(typeof iterable.then,'undefined');assert.equal(f.calls.length,0);
  const it=iterable[Symbol.asyncIterator]();assert.throws(()=>iterable[Symbol.asyncIterator](),/single_consumer/);
  const first=it.next();const parallel=assert.rejects(it.next(),/parallel_next/);
  await parallel;await tick();
  const closing=it.return();assert.equal(it.return(),closing);await closing;
  assert.deepEqual((await first).value,connected);
  assert.deepEqual((await it.next()).value,negative);
  assert.deepEqual(await it.next(),{done:true,value:undefined});assert.deepEqual(await it.next(),{done:true,value:undefined});
  assert.equal(f.stream.stats.cancels,1);assert.equal(f.stream.stats.releases,1);assert.equal(f.resources.size,0);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'http://127.0.0.1:43123/api/event');
  assert.equal(f.calls[0].init.headers.Accept,'text/event-stream');
});

test('every byte split handles Unicode, comments, multiline data, CRLF and lone CR',async()=>{
  for(const separator of ['\n','\r\n','\r']) {
    const e=event('session.execution.failed','evt_unicode',{sessionID:'ses_root',error:{type:'test',message:'😀é'}});
    const text=(frame(connected)+': heartbeat\n\n'+frame(e)).replaceAll('\n',separator),wire=bytes(text);
    for(let i=0;i<=wire.length;i++) {
      const f=streamFixture([wire.slice(0,i),wire.slice(i)]),it=f.client.event.subscribe(opts());
      const first=it.next();await tick();await it.return();assert.deepEqual((await first).value,connected);
      assert.deepEqual((await it.next()).value,e);assert.equal((await it.next()).done,true);
    }
  }
  const text='data: {"id":"evt_connect",\ndata: "type":"server.connected","data":{}}\n\n';
  const f=streamFixture([bytes(text)]),it=f.client.event.subscribe(opts());assert.deepEqual((await it.next()).value,connected);await it.return();
});

test('already issued fulfilled read is processed after synchronous return and no new read starts',async()=>{
  const f=streamFixture([bytes(frame(connected))]),it=f.client.event.subscribe(opts());
  await it.next();await tick();const n=f.stream.stats.reads;
  f.stream.emit(bytes(frame(event())));const closed=it.return();await closed;
  assert.equal(f.stream.stats.reads,n);assert.equal((await it.next()).value.type,'session.execution.failed');
  assert.equal((await it.next()).done,true);
});

test('malformed SSE, replay, reconnect and all bounded overflows keep the complete prefix',async(t)=>{
  for(const [name,suffix,changes,code] of [
    ['replay',frame(connected),{},'event_reconnect'],
    ['duplicate ID',frame(event('session.execution.started','evt_connect',{sessionID:'ses_root'})),{},'event_replay'],
    ['id field','id: forbidden\n\n',{},'unsupported_sse_field'],
    ['retry field','retry: 1\n\n',{},'unsupported_sse_field'],
    ['named event','event: native\n\n',{},'unsupported_sse_field'],
    ['malformed','data: {\n\n',{},'invalid_json'],
    ['unknown',frame({...event(),type:'unknown.type'}),{},'unsupported_event_type'],
    ['missing native created',frame({id:'evt_bad',type:'session.execution.started',data:{sessionID:'ses_root'}}),{},'invalid_wire_shape'],
    ['bad durable',frame({...event(),durable:{aggregateID:'ses_root',seq:-1,version:1}}),{},'invalid_wire_shape'],
    ['event bound',frame(event()),{limits:{maxEvents:1}},'event_limit'],
    ['frame bound',':'+ 'x'.repeat(150)+'\n\n',{limits:{maxFrameBytes:100}},'frame_byte_limit'],
    ['heartbeat bytes',':'+ 'x'.repeat(150)+'\n\n',{limits:{maxBytes:150}},'response_byte_limit'],
    ['UTF-8',new Uint8Array([255,10,10]),{},'invalid_utf8'],
  ]) await t.test(name,async()=>{
    const f=streamFixture([bytes(frame(connected)),typeof suffix==='string'?bytes(suffix):suffix],changes);
    const it=f.client.event.subscribe({maxBytes:changes.limits?.maxBytes ?? 4194304});
    assert.deepEqual((await it.next()).value,connected);await tick();await it.return();
    await assert.rejects(it.next(),{message:code});await assert.rejects(it.next(),{message:code});assert.equal(f.resources.size,0);
  });
  const f=streamFixture([bytes(frame(connected)+frame(event('session.execution.started','evt_start',{sessionID:'ses_root'}))+frame(event()))],{limits:{maxQueue:1}});
  const it=f.client.event.subscribe(opts());await it.next();await tick();await it.return();
  assert.equal((await it.next()).value.id,'evt_start');await assert.rejects(it.next(),/event_queue_limit/);
});

test('partial tail, remote loss, rejected cancellation and late settlement never certify EOF',async(t)=>{
  for(const tail of [bytes('data: {'),new Uint8Array([0xf0,0x9f]),bytes(': heartbeat')]) {
    const f=streamFixture([bytes(frame(connected)),tail]),it=f.client.event.subscribe(opts());
    await it.next();await tick();await it.return();await assert.rejects(it.next(),/stream_partial_frame/);
  }
  await t.test('remote EOF',async()=>{
    const r={status:200,headers:new Headers({'content-type':'text/event-stream'}),body:body([bytes(frame(connected))])};
    const f=fixture(()=>r),it=f.client.event.subscribe(opts());await it.next();await tick();await it.return();
    await assert.rejects(it.next(),/event_loss/);
  });
  await t.test('rejected cancellation',async()=>{
    const f=streamFixture([bytes(frame(connected))]),it=f.client.event.subscribe(opts());
    const original=f.stream.reader.cancel;f.stream.reader.cancel=()=>{original();return Promise.reject(Error('secret cancel error'));};
    await it.next();await tick();await assert.rejects(it.return(),/transport_teardown_failed/);
    await assert.rejects(it.next(),/transport_teardown_failed/);assert.equal(f.resources.size,1);
  });
  await t.test('hung read then late bytes',async()=>{
    const f=streamFixture([bytes(frame(connected))],{limits:{closeMs:10}}),it=f.client.event.subscribe(opts());
    f.stream.reader.cancel=()=>Promise.resolve();await it.next();await tick();
    await assert.rejects(it.return(),/transport_teardown_failed/);assert.equal(f.resources.size,1);
    f.stream.emit(bytes(frame(event())));await tick();
    await assert.rejects(it.next(),/transport_teardown_failed/);assert.equal(f.resources.size,0);
  });
});

const user=id=>({id,type:'user',time:{created:1},text:'test'});
const idle=(id,outcome='succeeded')=>({id,type:'idle',time:{created:2},outcome});
test('native message discriminants and nested schema are validated, not filtered',async()=>{
  const valid=[user('msg_user'),{id:'msg_assistant',type:'assistant',time:{created:1},agent:'agent',
    model:{id:'model',providerID:'provider'},content:[{type:'text',text:'result'}]},idle('msg_idle')];
  const f=fixture(()=>response({data:valid,cursor:{next:'opaque',previous:'opaque2'}}));
  assert.deepEqual((await f.client.message.list({sessionID:'ses_root',limit:200,order:'desc'},opts())).data,valid);
  for(const type of ['agent-switched','model-switched','location-switched','synthetic','system','skill','shell','compaction','other']) {
    const page={data:[{...user('msg_extra'),type}],cursor:{}},f=fixture(()=>response(page));
    const read=f.client.message.list({sessionID:'ses_root',limit:200,order:'desc'},opts());
    if(type==='synthetic' || type==='system') assert.deepEqual(await read,page);
    else await assert.rejects(read,type==='other'?/unsupported_message_type/:/invalid_wire_shape/);
  }
  for(const row of [{...user('bad'),id:'bad'},{...user('msg_x'),time:{}},{...user('msg_x'),text:5},
    {...idle('msg_x'),outcome:'done'},{...valid[1],content:[{type:'text',text:5}]}]) {
    const f=fixture(()=>response({data:[row],cursor:{}}));
    await assert.rejects(f.client.message.list({sessionID:'ses_root',limit:200,order:'desc'},opts()),/invalid_wire_shape/);
  }
});

test('job and inbox native variants/statuses plus foreign active IDs remain visible',async()=>{
  const jobs=['running','completed','error','cancelled'].flatMap(status=>[
    {id:`shell_${status}`,kind:'shell',sessionID:'ses_root',status,time:{started:1},shellID:'shell',command:'true'},
    {id:`agent_${status}`,kind:'subagent',sessionID:'ses_root',childSessionID:'ses_child',status,time:{started:1},agent:'agent',description:'test'},
    {id:`image_${status}`,kind:'image',sessionID:'ses_root',status,time:{started:1},path:'image',model:'model'},
  ]);
  const inbox=['user','synthetic','compaction','move'].map((type,i)=>({id:`msg_${i}`,sessionID:'ses_root',
    time:{created:1},type,delivery:i%2?'steer':'queue',payload:type==='compaction'?{}:type==='move'?
      {projectID:'project',location:{directory:'/synthetic'}}:{text:'test'}}));
  const responses=[response({data:jobs}),response({data:inbox})],f=fixture(()=>responses.shift());
  assert.deepEqual(await f.client.experimental.job.list({sessionID:'ses_root',descendants:true},opts()),jobs);
  assert.deepEqual(await f.client.session.inbox.list({sessionID:'ses_root'},opts()),inbox);
  for(const data of [[{...jobs[0],status:'unknown'}],[{...jobs[1],childSessionID:5}]]) {
    const f=fixture(()=>response({data}));await assert.rejects(f.client.experimental.job.list({sessionID:'ses_root',descendants:true},opts()),/invalid_wire_shape/);
  }
  const bad=fixture(()=>response({data:{ses_foreign:{type:'idle'}}}));await assert.rejects(bad.client.session.active(undefined,opts()),/invalid_wire_shape/);
});

async function verifyWire(config={}) {
  const stream=body([bytes(frame(connected))],{open:true});let launched=false,launches=0,activeReads=0;
  const baseline=config.baseline ?? [user('msg_old')];
  const projection=config.projection ?? [idle('msg_end'),user('msg_prompt'),...baseline];
  const f=fixture((url,init)=>{
    const u=new URL(url);
    if(u.pathname==='/api/event') return {status:200,headers:new Headers({'content-type':'text/event-stream'}),body:stream};
    if(u.pathname.endsWith('/message')) {
      const cursor=u.searchParams.get('cursor');
      if(config.repeatCursor && cursor) return response({data:[],cursor:{next:'page_0'}});
      if(launched && cursor && config.olderFailure) return response({message:'private'},500);
      const all=launched?projection:baseline,offset=cursor?Number(cursor.slice(5)):0;
      const data=all.slice(offset,offset+200);
      return response({data,cursor:data.length?{next:config.repeatCursor?'page_0':`page_${offset+200}`}:{}});
    }
    if(u.pathname.endsWith('/wait')) return response(undefined,204);
    if(u.pathname==='/api/experimental/job') return response({data:launched && config.jobs?config.jobs:[]});
    if(u.pathname.endsWith('/inbox')) return response({data:launched && config.inbox?config.inbox:[]});
    assert.equal(u.pathname,'/api/session/active');activeReads++;
    if(!launched && config.preflightDelivery) stream.emit(bytes(frame(event('session.inbox.delivered','evt_early',
      {sessionID:'ses_root',inboxID:'msg_prompt'}))));
    if(launched && config.closeFailure) {
      // This issued read is fulfilled before the verifier's final HTTP read
      // resumes. Its negative must survive the ensuing abort/return fence.
      stream.emit(bytes(frame(event())));
    }
    return response({data:launched && config.active?config.active:{}});
  });
  const result=await verifyNativeCompletion({client:f.client,binding,limits:{deadlineMs:1000,closeMs:100},
    launch:async({binding})=>{
      assert.ok(activeReads>0);assert.equal(f.calls[0].url.endsWith('/api/event'),true);
      launched=true;launches++;
      if(!config.noDelivery) stream.emit(bytes(frame(event('session.inbox.delivered','evt_delivered',
        {sessionID:'ses_root',inboxID:'msg_prompt'}))));
      return {binding,raw:bytes('untouched raw')};
    }});
  assert.equal(result.accepted,false);assert.equal(result.phase,'PROVISIONAL');assert.equal(result.wire.status,'unqualified');
  assert.equal(f.resources.size,0);assert.equal(stream.stats.releases,1);
  return {result,f,launches};
}
test('unchanged verifier consumes descending >200 histories through the empty sentinel',async()=>{
  const baseline=Array.from({length:201},(_,i)=>user(`msg_old_${i}`));
  const {result,f}=await verifyWire({baseline});assert.equal(result.logicalProof,true);
  const urls=f.calls.map(c=>c.url).filter(u=>u.includes('/message?'));
  assert.equal(urls.length,6);assert.ok(urls[2].endsWith('cursor=page_400'));assert.ok(urls[5].endsWith('cursor=page_400'));
  assert.equal(result.native.idleID,'msg_end');
  const assistant=i=>({id:`msg_a_${i}`,type:'assistant',time:{created:2},agent:'agent',model:{id:'model',providerID:'provider'},content:[]});
  const projection=[...Array.from({length:199},(_,i)=>assistant(i)),idle('msg_first'),user('msg_prompt'),...baseline];
  assert.equal((await verifyWire({baseline,projection})).result.native.idleID,'msg_first');
});
test('unchanged verifier fails on conflicts, unseen history and nonempty native state',async(t)=>{
  for(const [name,config,issue] of [
    ['preflight delivery',{preflightDelivery:true},'preflight_event_conflict'],
    ['close failure',{closeFailure:true},'contradictory_terminal_event'],
    ['missing delivery',{noDelivery:true},'prompt_not_corroborated'],
    ['missing idle',{projection:[user('msg_prompt'),user('msg_old')]},'native_idle_missing_or_invalid'],
    ['missing anchor',{projection:[]},'baseline_changed'],
    ['duplicate IDs',{projection:[idle('msg_end'),user('msg_prompt'),user('msg_prompt'),user('msg_old')]},'invalid_message_identity'],
    ['repeated cursor',{repeatCursor:true},'repeated_cursor'],
    ['foreign active',{active:{ses_other:{type:'running'}}},'unexpected_active'],
    ['job',{jobs:[{id:'job',sessionID:'ses_root',kind:'image',status:'completed',time:{started:1},path:'path',model:'model'}]},'unexpected_jobs'],
    ['inbox',{inbox:[{id:'msg_queued',sessionID:'ses_root',type:'compaction',payload:{},delivery:'queue',time:{created:1}}]},'unexpected_inbox'],
  ]) await t.test(name,async()=>{
    const {result,launches}=await verifyWire(config);assert.equal(result.logicalProof,false);
    assert.ok(result.health.issues.includes(issue),JSON.stringify(result.health));
    if(config.preflightDelivery) assert.equal(launches,0);
  });
  for(const outcome of ['failed','interrupted']) {
    const {result}=await verifyWire({olderFailure:true,projection:[idle('msg_negative',outcome),user('msg_prompt')]});
    assert.equal(result.native.outcome,outcome);assert.equal(result.logicalProof,false);assert.equal(result.admission.status,'unknown');
  }
});

test('abort removes caller/lease listeners; return-before-next opens no connection',async()=>{
  const caller=new AbortController(),f=streamFixture([bytes(frame(connected))]);
  const it=f.client.event.subscribe({signal:caller.signal});await it.next();await tick();
  caller.abort();await it.return();assert.equal((await it.next()).done,true);
  assert.equal(getEventListeners(caller.signal,'abort').length,0);
  assert.equal(getEventListeners(f.revoke.signal,'abort').length,0);
  const g=streamFixture([]),unused=g.client.event.subscribe(opts());await unused.return();assert.equal((await unused.next()).done,true);
  assert.equal(g.calls.length,0);assert.equal(g.resources.size,0);
});

test('lease revocation at registration prevents dispatch; invalid Basic value is refused',async()=>{
  for(const authorization of ['Basic YQ==','Basic !!!','Basic b3BlbmNvZGU6','Bearer abc','Basic YTpi\r\nX: y'])
    assert.throws(()=>fixture(()=>{}, {authorization}),/invalid_endpoint_lease/);
  let sends=0,released=0;const revoke=new AbortController();
  const client=makeCompletionReadClient({endpointLease:{origin:'http://127.0.0.1:43123',authorization:'Basic b3BlbmNvZGU6dGVzdA==',
    sessionIDs:['ses_root'],incarnationID:'incarnation',signal:revoke.signal},binding,
    fetchImpl:()=>{sends++;return response({data:{}});},transportOwner:{track(){revoke.abort();return()=>{released++;};}}});
  await assert.rejects(client.session.active(undefined,opts()),/read_aborted/);assert.equal(sends,0);assert.equal(released,1);
});

test('structure limits, overlong IDs, invalid envelopes and unknown nested fields fail closed',async()=>{
  for(const [value,limits,code] of [
    [{data:[user('msg_'+ 'x'.repeat(513))],cursor:{}},{},'invalid_wire_shape'],
    [{data:[],cursor:{next:7}},{},'invalid_wire_shape'],
    [{data:[],cursor:{},extra:1},{},'invalid_wire_shape'],
    [{data:[{...user('msg_x'),metadata:{a:{b:{c:1}}}}],cursor:{}},{maxDepth:5},'json_structure_limit'],
    [{data:[user('msg_x')],cursor:{}},{maxNodes:5},'json_structure_limit'],
  ]) {
    const f=fixture(()=>response(value),{limits});
    await assert.rejects(f.client.message.list({sessionID:'ses_root',limit:200,order:'desc'},opts()),{message:code});
  }
});

test('event errors at headers, before connected, and during teardown never leak remote diagnostics',async()=>{
  for(const status of [400,401,302,500]) {
    const f=fixture(()=>response({private:'REMOTE_SECRET'},status)),it=f.client.event.subscribe(opts());
    await assert.rejects(it.next(),{message:`http_status_${status}`});await it.return();assert.equal(f.calls.length,1);
  }
  const f=streamFixture([bytes(frame(event()))]),it=f.client.event.subscribe(opts());
  await assert.rejects(it.next(),/connected_required/);await it.return();
  const wrong=fixture(()=>response({},200,'application/json')),bad=wrong.client.event.subscribe(opts());
  await assert.rejects(bad.next(),/unsupported_content_type/);await bad.return();
  const live=streamFixture([bytes(frame(connected))],{limits:{closeMs:10}}),reader=live.stream.reader;
  let settleCancel;const original=reader.cancel;
  reader.cancel=()=>{original();return new Promise(resolve=>{settleCancel=resolve;});};
  const stalled=live.client.event.subscribe(opts());await stalled.next();await tick();
  await assert.rejects(stalled.return(),/transport_teardown_failed/);assert.equal(live.resources.size,1);
  settleCancel();await tick();assert.equal(live.resources.size,0);await assert.rejects(stalled.next(),/transport_teardown_failed/);
});

test('lease IDs cannot create URL dot segments or invalid URI encoding',()=>{
  for(const sessionID of ['.','..','\ud800']) {
    const signal=new AbortController().signal;
    assert.throws(()=>makeCompletionReadClient({endpointLease:{origin:'http://127.0.0.1:43123',authorization:'Basic b3BlbmNvZGU6dGVzdA==',
      sessionIDs:[sessionID],incarnationID:'incarnation',signal},binding:{...binding,sessionID,scope:{...binding.scope,sessionIDs:[sessionID]}},
      fetchImpl:()=>assert.fail('never dispatch'),transportOwner:{track(){return()=>{};}}}),/invalid_endpoint_lease/);
  }
  assert.throws(()=>makeCompletionReadClient({endpointLease:{origin:'http://127.0.0.1:43123',authorization:'Basic b3BlbmNvZGU6dGVzdA==',
    sessionIDs:['ses_root','ses_child'],incarnationID:'incarnation',signal:new AbortController().signal},
    binding:{...binding,scope:{...binding.scope,sessionIDs:['ses_root','ses_root']}},fetchImpl:()=>{},
    transportOwner:{track(){return()=>{};}}}),/invalid_endpoint_lease/);
});

test('no silent content in 204; redirected responses and shadowed byte lengths cannot bypass bounds',async()=>{
  const r=response(undefined,204);r.headers.set('content-length','10');const f=fixture(()=>r);
  await assert.rejects(f.client.experimental.session.wait({sessionID:'ses_root'},opts()),/unexpected_response_body/);
  const redirect=fixture(()=>({...response({data:{}}),redirected:true}));
  await assert.rejects(redirect.client.session.active(undefined,opts()),/redirect_refused/);
  const chunk=bytes('{"data":{}}');Object.defineProperty(chunk,'byteLength',{value:1});
  const limited=fixture(()=>({...response({}),body:body([chunk])}));
  await assert.rejects(limited.client.session.active(undefined,{maxBytes:1}),/response_byte_limit/);
});

test('same-chunk malformed suffix and buffered multiple deliveries retain prefix under abort',async()=>{
  const d1=event('session.inbox.delivered','evt_d1',{sessionID:'ses_root',inboxID:'msg_one'});
  const d2=event('session.inbox.delivered','evt_d2',{sessionID:'ses_root',inboxID:'msg_two'});
  const f=streamFixture([bytes(frame(connected)+frame(d1)+frame(d2)+'data: {\n\n')]);
  const caller=new AbortController(),it=f.client.event.subscribe({signal:caller.signal});
  const first=it.next();await tick();caller.abort();await it.return();
  assert.deepEqual((await first).value,connected);assert.deepEqual((await it.next()).value,d1);assert.deepEqual((await it.next()).value,d2);
  await assert.rejects(it.next(),/invalid_json/);await assert.rejects(it.next(),/invalid_json/);
  assert.equal(f.calls.length,1);assert.equal(f.resources.size,0);
});

test('immediate return after next seals an unopened request without inventing loss',async()=>{
  const f=streamFixture([]),it=f.client.event.subscribe(opts());
  const next=it.next();await it.return();assert.deepEqual(await next,{done:true,value:undefined});
  assert.equal(f.calls.length,0);assert.equal(f.resources.size,0);
  const aborted=new AbortController();aborted.abort();
  const g=streamFixture([]),bad=g.client.event.subscribe({signal:aborted.signal});
  await assert.rejects(bad.next(),/read_aborted/);await bad.return();assert.equal(g.calls.length,0);
});

test('ordinary native event location retains its optional workspace identity',async()=>{
  const native={...event(),location:{directory:'/synthetic',workspaceID:'workspace'}};
  const f=streamFixture([bytes(frame(connected)+frame(native))]),it=f.client.event.subscribe(opts());
  await it.next();await tick();await it.return();assert.deepEqual((await it.next()).value,native);
  assert.equal((await it.next()).done,true);
});

test('every declared error status fails on its exact logical route without response diagnostics',async()=>{
  const cases=[
    [(c,o)=>c.message.list({sessionID:'ses_root',limit:200,order:'desc'},o),[400,401,404,500]],
    [(c,o)=>c.experimental.session.wait({sessionID:'ses_root'},o),[400,401,404,503]],
    [(c,o)=>c.experimental.job.list({sessionID:'ses_root',descendants:true},o),[400,401,404]],
    [(c,o)=>c.session.inbox.list({sessionID:'ses_root'},o),[400,401,404]],
    [(c,o)=>c.session.active(undefined,o),[400,401]],
  ];
  for(const [call,statuses] of cases) for(const status of statuses) {
    const f=fixture(()=>response({message:'PRIVATE_RESPONSE'},status));
    await assert.rejects(call(f.client,opts()),{message:`http_status_${status}`});assert.equal(f.resources.size,0);assert.equal(f.calls.length,1);
  }
  const f=fixture(()=>Promise.reject(Error('PRIVATE_TRANSPORT')));
  await assert.rejects(f.client.session.active(undefined,opts()),{message:'transport_failed'});assert.equal(f.resources.size,0);
});

test('standard in-memory Web Streams preserve the seal prefix and release their lock',async()=>{
  let controller,cancels=0;
  const stream=new ReadableStream({start(c){controller=c;c.enqueue(bytes(frame(connected)));},cancel(){cancels++;}});
  const f=fixture(()=>new Response(stream,{headers:{'content-type':'text/event-stream'}}));
  const it=f.client.event.subscribe(opts());await it.next();await tick();
  controller.enqueue(bytes(frame(event())));await it.return();
  assert.equal((await it.next()).value.id,'evt_failure');assert.equal((await it.next()).done,true);
  assert.equal(cancels,1);assert.equal(stream.locked,false);assert.equal(f.resources.size,0);
});
