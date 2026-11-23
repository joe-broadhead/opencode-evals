import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCompletionReadClient} from '../src/run/native-completion-http.mjs';
import {verifyNativeCompletion} from '../src/run/native-completion.mjs';

const binding={caseID:'case',trialID:'trial',turnID:'turn',activationID:'activation',
  incarnationID:'inc',sessionID:'ses_root',scope:{complete:true,serial:true,sessionIDs:['ses_root']}};
const model={id:'model',providerID:'provider'}, location={directory:'/fixture'};
const record=(id,type,fields={})=>({id,type,time:{created:2},...fields});
const user=id=>record(id,'user',{text:'same text'});
const idle=(outcome='succeeded',id='msg_first')=>record(id,'idle',{outcome});
const annotations=[record('msg_agent','agent-switched',{agent:'build'}),
  record('msg_model','model-switched',{model}),record('msg_system','system',{text:'instructions',metadata:{opaque:[null]}})];
const work=[record('msg_synthetic','synthetic',{text:'same text'}),
  record('msg_skill','skill',{skill:'skill',name:'name',text:'context'}),
  record('msg_shell','shell',{shellID:'shell',command:'not executed',status:'exited',exit:0}),
  record('msg_compaction','compaction',{status:'completed',reason:'auto',summary:'context'}),
  record('msg_move','location-switched',{location,previous:null})];
const assistant=record('msg_assistant','assistant',{agent:'build',model,content:[{type:'text',text:'answer 😀'}]});
const event=(type,id,data={},version=1)=>({id:'evt_'+id,type,created:3,data:{sessionID:'ses_root',...data},
  ...(version?{durable:{aggregateID:data.sessionID??'ses_root',seq:1,version}}:{})});
const connected={id:'evt_connected',type:'server.connected',data:{}};
const delivered=event('session.inbox.delivered','delivered',{inboxID:'msg_prompt'});
const failed=event('session.execution.failed','failed',{error:{type:'example',message:'failed'}});
const a={assistantMessageID:'msg_assistant'};
// Representative source-shaped payloads; the existing codec suite owns the full union matrix.
const mixed=[event('session.step.started','step',{...a,agent:'build',model,started:3}),
  event('session.text.delta','text',{...a,ordinal:0,delta:'same text'},0),
  event('session.tool.success','tool',{...a,id:'call',content:[{type:'text',text:'result'}],executed:true},2),
  event('session.step.failed','step_failed',{...a,error:{type:'example',message:'step diagnostic'}}),
  {id:'evt_rpc',type:'rpc.example.changed',created:3,location,data:{inboxID:'msg_prompt',outcome:'succeeded',opaque:[null]}}];
const bytes=s=>Buffer.from(s), frame=e=>`data: ${JSON.stringify(e)}\n\n`;
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function observe(config={}) {
  const baseline=config.baseline??[], projection=config.projection??[idle(),assistant,user('msg_prompt'),...baseline];
  const queue=[bytes(frame(connected))], resources=new Set(), calls=[];
  let pending,ended=false,launched=false,cancels=0,releases=0,launches=0;
  const emit=value=>{if(pending){const resolve=pending;pending=undefined;resolve({done:false,value});}else queue.push(value);};
  const finish=()=>{ended=true;pending?.({done:true});pending=undefined;};
  const reader={
    read(){if(queue.length)return Promise.resolve({done:false,value:queue.shift()});
      if(ended)return Promise.resolve({done:true});return new Promise(resolve=>{pending=resolve;});},
    cancel(){cancels++;if(config.closeTail){assert.ok(pending,'issued read exists at seal');emit(bytes(config.closeTail));}finish();return Promise.resolve();},
    releaseLock(){releases++;},
  };
  const json=(value,status=200)=>({status,headers:new Headers({'content-type':'application/json'}),
    body:new ReadableStream({start(c){if(value!==undefined)c.enqueue(bytes(JSON.stringify(value)));c.close();}})});
  const lease={origin:'http://127.0.0.1:43123',authorization:'Basic b3BlbmNvZGU6dGVzdA==',
    incarnationID:'inc',sessionIDs:['ses_root'],signal:new AbortController().signal,limits:{closeMs:50}};
  const client=makeCompletionReadClient({endpointLease:lease,binding,
    transportOwner:{track(handle){resources.add(handle);return()=>{assert.ok(resources.delete(handle));};}},
    fetchImpl:async(url,init)=>{
      calls.push({url,method:init.method});const u=new URL(url);
      assert.equal(u.origin,'http://127.0.0.1:43123');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
      if(u.pathname==='/api/event')return {status:200,headers:new Headers({'content-type':'text/event-stream'}),body:{getReader:()=>reader}};
      if(u.pathname.endsWith('/message')) {
        assert.equal(u.pathname,'/api/session/ses_root/message');
        if(launched && config.pageFailure && u.searchParams.has('cursor'))return json({message:'private'},500);
        return json({data:launched?projection:baseline,cursor:launched&&config.pageFailure?{next:'older'}:{}});
      }
      if(u.pathname.endsWith('/wait'))return json(undefined,204);
      if(u.pathname==='/api/experimental/job'||u.pathname.endsWith('/inbox'))return json({data:[]});
      assert.equal(u.pathname,'/api/session/active');return json({data:launched?(config.active??{}):{}});
    }});
  // The trusted lease is snapshotted; caller mutation must not redirect or widen reads.
  lease.origin='http://not-used.invalid';lease.incarnationID='other';lease.sessionIDs.push('ses_foreign');
  await assert.rejects(client.message.list({sessionID:'ses_foreign',limit:200,order:'desc'}),/foreign_session/);
  assert.equal(calls.length,0);
  const storage=Buffer.from([9,0,255,13,10,114,97,119,0,9]),raw=storage.subarray(1,9),before=Buffer.from(storage);
  const result=await verifyNativeCompletion({client,binding,limits:{deadlineMs:1000,closeMs:100},
    launch:async({binding:bound})=>{
      launches++;launched=true;assert.deepEqual(bound,binding);
      const events=config.events??[delivered,...mixed];emit(bytes(events.map(frame).join('')));await tick();
      if(config.loss){finish();await tick();}
      return {binding:bound,raw};
    }});
  assert.equal(launches,1);assert.equal(resources.size,0);assert.equal(cancels,1);assert.equal(releases,1);
  assert.deepEqual(storage,before);assert.deepEqual(result.raw,{status:'known',bytes:8,
    sha256:'ebd544b8ca0dd0318f7b26d2ec4518aae2fad53b057e995062f645cb59b25b9f'});
  assert.equal(result.accepted,false);assert.equal(result.phase,'PROVISIONAL');assert.equal(result.wire.status,'unqualified');
  assert.deepEqual(result.binding,binding);
  return result;
}
const eventsOf=r=>r.evidence.filter(e=>e.kind==='event').map(e=>e.value);

test('native annotations preserve exact delivered user, first idle, history, mixed events and raw bytes',async()=>{
  const history=[...annotations,...work,assistant,user('msg_history'),idle()].map((m,i)=>({...m,id:`msg_old_${i}`,time:{created:1}}));
  const projection=[idle('succeeded','msg_later'),annotations[2],idle('failed'),assistant,annotations[1],user('msg_prompt'),annotations[0],...history];
  const r=await observe({baseline:history,projection});
  assert.equal(new Set(history.map(m=>m.type)).size,11);
  assert.deepEqual(r.admission,{status:'known',promptID:'msg_prompt'});
  assert.deepEqual(r.native,{status:'known',promptID:'msg_prompt',idleID:'msg_first',outcome:'failed'});
  assert.equal(r.logicalProof,false);assert.deepEqual(r.health.issues,[]);
  assert.deepEqual(r.evidence.find(e=>e.kind==='baseline').value,{data:history,cursor:{}});
  assert.deepEqual(r.evidence.find(e=>e.kind==='projection').value,{data:projection,cursor:{}});
  assert.deepEqual(eventsOf(r),[connected,delivered,...mixed]);
  const success=await observe({projection:[annotations[2],idle(),annotations[1],user('msg_prompt'),annotations[0]]});
  assert.equal(success.logicalProof,true);assert.equal(success.native.idleID,'msg_first');
});

test('new synthetic, skill, shell, compaction, location and second-user work cannot borrow the controlled idle',async()=>{
  for(const conflicting of [...work,user('msg_second')]) for(const beforePrompt of [false,true]) {
    const projection=beforePrompt?[idle(),user('msg_prompt'),conflicting]:[idle(),conflicting,user('msg_prompt')];
    const r=await observe({projection});
    assert.equal(r.logicalProof,false,conflicting.type);assert.equal(r.admission.status,'unknown');
    assert.ok(r.health.issues.includes('prompt_not_corroborated'));
    if(conflicting.type!=='user')assert.ok(r.health.issues.includes('conflicting_transcript_work'));
    assert.deepEqual(r.evidence.find(e=>e.kind==='projection').value.data,projection);
  }
});

test('text/tool/step/RPC payloads and event IDs never replace exact delivery or transcript idle authority',async()=>{
  const terminal=event('session.execution.succeeded','msg_prompt');
  for(const config of [
    {events:[...mixed,terminal]},
    {events:[{...delivered,data:{sessionID:'ses_root',inboxID:'msg_other'}},...mixed,terminal]},
    {events:[delivered,...mixed,terminal],projection:[assistant,user('msg_prompt')]},
  ]) {
    const r=await observe(config);assert.equal(r.logicalProof,false);
    assert.deepEqual(eventsOf(r),[connected,...config.events]);
    assert.ok(r.health.issues.includes(config.projection?'native_idle_missing_or_invalid':'prompt_not_corroborated'));
  }
});

test('a failure from the issued read at close survives sealing and contradicts a successful transcript',async()=>{
  const r=await observe({closeTail:frame(failed)});
  assert.equal(r.native.outcome,'succeeded');assert.equal(r.logicalProof,false);
  assert.ok(r.health.issues.includes('contradictory_terminal_event'));
  assert.deepEqual(eventsOf(r),[connected,delivered,...mixed,failed]);
  assert.equal(r.health.fence,'complete');
});

test('duplicate frames, partial close tails, loss and later page failure preserve already bound native negatives',async()=>{
  for(const outcome of ['failed','interrupted']) for(const [config,issue] of [
    [{closeTail:frame(failed)+frame(failed)},'event_replay'],
    [{closeTail:frame(failed)+'data: {"unfinished":'},'stream_partial_frame'],
    [{events:[delivered,...mixed,failed],loss:true},'event_loss'],
    [{pageFailure:true},'read_projection_unavailable'],
  ]) {
    const projection=[annotations[2],idle(outcome),annotations[1],user('msg_prompt'),annotations[0]];
    const r=await observe({...config,projection});
    assert.equal(r.logicalProof,false);assert.equal(r.native.outcome,outcome);
    assert.equal(r.native.promptID,'msg_prompt');assert.equal(r.native.idleID,'msg_first');
    assert.ok(r.health.issues.includes(issue),JSON.stringify(r.health));
    assert.deepEqual(r.evidence.find(e=>e.kind==='projection').value.data,projection);
    if(!config.pageFailure)assert.deepEqual(eventsOf(r).at(-1),failed);
    else assert.equal(r.health.transport,'unavailable');
  }
});

test('lease identity remains fixed while foreign native event IDs and status maps remain visible',async()=>{
  assert.throws(()=>makeCompletionReadClient({endpointLease:{origin:'http://127.0.0.1:43123',
    authorization:'Basic b3BlbmNvZGU6dGVzdA==',incarnationID:'foreign',sessionIDs:['ses_root'],signal:new AbortController().signal},
    binding,fetchImpl:()=>assert.fail('must not dispatch'),transportOwner:{track:()=>assert.fail('must not register')}}),/invalid_endpoint_lease/);
  const active={ses_foreign:{type:'running'}},r=await observe({active});
  assert.equal(r.logicalProof,false);assert.ok(r.health.issues.includes('unexpected_active'));
  assert.deepEqual(r.evidence.find(e=>e.kind==='final_active').value,active);
  const foreign=event('session.text.delta','foreign',{...a,sessionID:'ses_foreign',ordinal:0,delta:'same text'},0);
  const other=await observe({events:[delivered,...mixed,foreign]});
  assert.equal(other.logicalProof,false);assert.equal(other.admission.status,'unknown');
  assert.ok(other.health.issues.includes('foreign_session_event'));assert.deepEqual(eventsOf(other).at(-1),foreign);
});
