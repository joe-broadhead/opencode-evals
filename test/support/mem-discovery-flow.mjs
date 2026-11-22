// Synthetic finite flow through the real native codecs. Not a recorded runtime run.
import assert from 'node:assert/strict';
import {discoveryIntent,renderDiscoveryCase} from '../../packs/mem/discovery-plan.mjs';
import {createDiscoveryStore} from '../../worlds/mem/discovery-store.mjs';
import {compileCase} from '../../src/case/compile.mjs';
import {gradeCase,runView} from '../../src/grade/grade.mjs';
import {adapterState} from '../../src/grade/adapters/index.mjs';
import {events} from '../../src/trace/normalise.mjs';
import {memoryTurn} from '../../src/run/mem-turns.mjs';
import {projectMemoryRecording} from '../../src/grade/adapters/mem-recording.mjs';

export function normalizedDiscovery(calls,s,mode='direct',session='ses_spec',trial_id='spec_trial'){
  // Synthetic native observations captured from the completed operation list BEFORE any source/proof
  // mutation. This is a consumer fixture, not a claim that the unmerged native producer emitted it.
  const observed=structuredClone(calls);
  const rawLines=[...calls.map((c,i)=>({type:'tool_use',sessionID:session,part:{id:`part_${i}`,callID:`call_${i}`,tool:mode==='direct'?c.tool:'execute',state:{input:mode==='direct'?c.args:{code:`return await tools.mem.${c.tool.slice(4)}(${JSON.stringify(c.args)})`},output:c.output,status:c.status}}})),{type:'text',sessionID:session,part:{text:s.answer}}].map(v=>JSON.stringify(v));
  const source={case_id:s.id,trial:1},raw_sha256=projectMemoryRecording(rawLines,source).raw_sha256;
  const journal=mode==='execute'?{schema:'oc-mem-invocations/1',scope:{...source,trial_id,turn:1,session},raw_sha256,complete:true,calls:observed.map((c,i)=>({call_id:`native_${i}`,carrier_call_id:`call_${i}`,tool:c.tool,args:c.args,status:c.status,output:c.output}))}:null;
  const recording=projectMemoryRecording(rawLines,source,journal),head={schema:'oc-trace/1',privacy:{raw:{sha256:recording.raw_sha256}}};
  return {rawLines,recording,journal,head,trace:events({rawLines}),turn:memoryTurn({code:0,stdout:rawLines.join('\n')},{index:1,prompt:s.prompt})};
}
export function discoveryFlow(s,mode='direct',{recordMetadata=null,confirmation=null}={}){
  const trial_id='spec_trial',session='ses_spec',context={case_id:s.id,trial_id,session,turn:1,active:true};
  const intent=discoveryIntent(s,trial_id,Date.now()+60000),store=createDiscoveryStore({spec:s,intent}),calls=[];
  let args=structuredClone(s.binding.args),input=structuredClone(s.backend.input);
  const lookup=(tool,args,method,input)=>{const r=store.request(method,input,{context});assert.equal(r.status,200);calls.push({tool:`mem_${tool}`,args,status:'completed',output:JSON.stringify(r.json)});return r.json};
  if(s.family==='exact-read'){const r=lookup('recall',{query:'Quartz',in:'memories',types:['fact']},'records.search',{query:'Quartz',kinds:['memory'],types:['fact'],status:'current',limit:20}).hits.find(r=>r.title==='Quartz fact');assert.ok(r?.id);args.id=r.id;input.ids=[r.id]}
  if(['wiki-read','wiki-write','wiki-graph','code'].includes(s.family)){
    const code=s.family==='code',row=lookup('wiki',{action:'list',type:code?'code-graph':'wiki'},code?'code-graph.list':'wiki.list',{}).items.find(r=>r.name===(code?'Quartz repository':'Quartz wiki'));
    const id=code?row?.code_graph_id:row?.wiki_id;assert.ok(id);
    if(code){const n=lookup('code',{action:'search',graph_id:id,query:'parseInvoice'},'code-graph.search',{code_graph_id:id,query:'parseInvoice',limit:20}).nodes.find(n=>n.name==='parseInvoice');assert.ok(n?.id);args={action:'callers',graph_id:id,symbol:n.id};input={code_graph_id:id,symbol:n.id}}
    else{args.wiki_id=id;input.wiki_id=id}
  }
  if(s.family==='skills'){const r=lookup('spaces',{action:'skills',skill:{op:'list'}},'skill.list',{filters:{},pagination:{limit:100,offset:0}}).items.find(r=>r.name==='Quartz');assert.ok(r?.skill_id);args.skill.id=r.skill_id;input.skill_id=r.skill_id}
  if(s.family==='sources'){const r=lookup('spaces',{action:'sources'},'sources.list',{}).sources.find(r=>r.source==='gmail');assert.ok(r?.account);input={source:r.source,account:r.account};args={action:'sources',bind:{...input}}}
  if(s.family==='jobs'){const r=lookup('spaces',{action:'jobs',job:{op:'templates'}},'jobs.templates',{}).templates.find(r=>r.connector==='slack');assert.ok(r?.id);input.template=r.id;args.job.template=r.id}
  if(recordMetadata)input.record={...input.record,...structuredClone(recordMetadata)};
  const invocation={...context,tool:`mem_${s.binding.tool}`,args,pass:true};
  const response=store.request(s.backend.method,input,{context,invocation});assert.equal(response.status,200);
  if(confirmation)response.json.confirmation=structuredClone(confirmation);
  calls.push({tool:invocation.tool,args,status:'completed',output:JSON.stringify(response.json)});
  const capture=store.capture();store.close();
  if(confirmation)for(const requests of [capture.requests,capture.discovery.requests])requests.at(-1).output.confirmation=structuredClone(confirmation);
  const normalized=normalizedDiscovery(calls,s,mode,session);
  // Retain the finite store's completed operation observations, not the codec's
  // source diagnostics. Tests may reuse these observations to build a new flow.
  // This synthetic proof copy claims no native host observation or wiring.
  capture.discovery.turns=[{...normalized.turn,calls_complete:true,calls:structuredClone(calls)}];
  const f={capture,trace:normalized.trace,rawLines:normalized.rawLines,recording:normalized.recording,journal:normalized.journal,head:normalized.head};
  f.grade=()=>{
    const files=[{path:'mem-fixture/capture.json',change:'added',text:JSON.stringify(capture)}];
    return gradeCase(compileCase(s.id+'.md',renderDiscoveryCase(s)),runView([f.head,...f.trace],{memoryRecording:f.recording,state:adapterState('mem',files),files,text:f.recording?.text??null,guardLog:[{kind:'guard_start',case_id:s.id,trial_id}]}));
  };
  return f;
}
