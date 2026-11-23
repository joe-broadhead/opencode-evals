import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCompletionReadClient } from '../src/run/native-completion-http.mjs';

// Literal wire examples from dc2ffcf8, generated/types.ts V2Event (2845-2943).
// No fixture is derived from the adapter's inventory or validators.
const sessionID='ses_root', assistantMessageID='msg_assistant', inboxID='msg_prompt';
const s={sessionID}, a={...s,assistantMessageID}, tool={...a,id:'call_1'};
const model={id:'model',providerID:'provider'}, location={directory:'/fixture'};
const error={type:'example',message:'failed'};
const tokens={input:1,output:2,reasoning:0,cache:{read:0,write:0}};
const shell={id:'shell_1',status:'running',command:'example',cwd:'/fixture',shell:'sh',file:'output',metadata:{},time:{started:1}};
const output={output:'example',cursor:7,size:7,truncated:false};
const pty={id:'pty_1',title:'terminal',command:'sh',args:[],cwd:'/fixture',status:'running',pid:1};
const terminal={...pty,sessionID,userTitle:null,foregroundProcess:null,size:{cols:80,rows:24},output:{head:0,tail:0}};
const rows=[
  ['location.shutdown',0,{}],['models-dev.refreshed',0,{}],['credential.updated',0,{}],
  ['credential.switched',0,{integrationID:'integration',credentialID:null}],
  ['integration.updated',0,{}],['provider.updated',0,{}],['model.updated',0,{}],['agent.updated',0,{}],
  ['session.created',1,{...s,projectID:'project',location,slug:'example',version:'2.2.6'}],
  ['session.agent.selected',1,{...s,agent:'agent'}],['session.model.selected',1,{...s,model}],
  ['session.moved',1,{...s,location,projectID:'project'}],['session.renamed',1,{...s,title:'example'}],
  ['session.metadata.updated',1,{...s,metadata:{opaque:['kept']}}],['session.permissions',1,{...s,permissions:[]}],
  ['session.viewed',1,{...s,idle:1}],['session.archived',1,s],['session.unarchived',1,s],
  ['session.usage.updated',0,{...s,cost:0,tokens}],['session.deleted',2,s],
  ['session.forked',2,{...s,parentID:'ses_parent',boundary:{type:'through',messageID:'msg_prior'}}],
  ['session.inbox.delivered',1,{...s,inboxID}],
  ['session.inbox.enqueued',1,{...s,inboxID,item:{type:'user',payload:{text:'question'},delivery:'queue'}}],
  ['session.inbox.cancelled',1,{...s,inboxID}],['session.inbox.delivery.changed',1,{...s,inboxID,delivery:'steer'}],
  ['session.execution.started',1,s],['session.execution.succeeded',1,s],
  ['session.execution.failed',1,{...s,error}],['session.execution.interrupted',1,{...s,reason:'user'}],
  ['session.instructions.updated',2,{...s,delta:{instructions:'removed'},text:'system update'}],
  ['session.synthetic',1,{...s,text:'context'}],['session.skill.activated',1,{...s,id:'skill',name:'skill',text:'context'}],
  ['session.shell.started',1,{...s,shell}],['session.shell.ended',1,{...s,shell:{...shell,status:'exited',exit:0},output}],
  ['session.step.started',1,{...a,agent:'agent',model,started:1}],['session.step.streamed',1,a],
  ['session.step.ended',1,{...a,finish:'stop',cost:0,tokens}],['session.step.failed',1,{...a,error}],
  ['session.text.started',1,{...a,ordinal:0}],['session.text.delta',0,{...a,ordinal:0,delta:'Hello 😀'}],
  ['session.text.ended',1,{...a,ordinal:0,text:'Hello 😀'}],
  ['session.reasoning.started',1,{...a,ordinal:1}],['session.reasoning.delta',0,{...a,ordinal:1,delta:'reason'}],
  ['session.reasoning.ended',1,{...a,ordinal:1,text:'reason'}],
  ['session.tool.input.started',1,{...tool,name:'example'}],['session.tool.input.delta',0,{...tool,delta:'{}'}],
  ['session.tool.input.ended',1,{...tool,text:'{}'}],['session.tool.called',1,{...tool,input:{},executed:false}],
  ['session.tool.progress',0,{...tool,metadata:{progress:[1,2]}}],
  ['session.tool.success',2,{...tool,content:[{type:'text',text:'result'}],executed:true}],
  ['session.tool.failed',2,{...tool,error,executed:true}],
  ['session.retry.scheduled',1,{...a,attempt:1,at:2,error}],
  ['session.compaction.started',1,{...s,reason:'auto'}],['session.compaction.delta',0,{...s,text:'summary'}],
  ['session.compaction.ended',1,{...s,reason:'auto',text:'summary'}],['session.compaction.failed',1,{...s,reason:'manual',error}],
  ['session.revert.staged',1,{...s,revert:{messageID:'msg_prior'}}],['session.revert.cleared',1,s],
  ['session.revert.committed',1,{...s,to:'msg_prior'}],
  ['filesystem.changed',0,{file:'file',event:'change'}],['reference.updated',0,{}],
  ['permission.asked',0,{...s,id:'permission',action:'read',resources:['file']}],
  ['permission.replied',0,{...s,requestID:'permission',reply:'once'}],['plugin.updated',0,{}],
  ['project.updated',0,{id:'project',canonical:'/fixture',time:{created:1,updated:1},sandboxes:[]}],
  ['worktree.updated',0,{projectID:'project'}],
  ['worktree.resolved',1,{projectID:'project',directory:'/fixture',previous:'old'}],
  ['command.updated',0,{}],['config.updated',0,{}],['skill.updated',0,{}],
  ['pty.created',0,{info:pty}],['pty.updated',0,{info:pty}],['pty.exited',0,{id:'pty_1',exitCode:0}],['pty.deleted',0,{id:'pty_1'}],
  ['persistent-pty.added',0,{...s,terminal}],['persistent-pty.removed',0,{...s,ptyID:'pty_1'}],['persistent-pty.updated',0,{...s,terminal}],
  ['shell.created',0,{info:shell}],['shell.exited',0,{id:'shell_1',exit:0,status:'exited'}],['shell.deleted',0,{id:'shell_1'}],
  ['form.created',0,{form:{id:'form',sessionID,title:'example',fields:[{type:'string',key:'answer'}]}}],
  ['form.replied',0,{id:'form',sessionID,answer:{}}],['form.cancelled',0,{id:'form',sessionID}],
  ['websearch.updated',0,{}],['artifact.updated',0,{}],['session.status',0,{...s,status:{type:'busy'}}],['session.idle',0,s],
  ['tui.prompt.append',0,{text:'example'}],['tui.command.execute',0,{command:'session.list'}],
  ['tui.toast.show',0,{message:'example',variant:'info'}],['tui.session.select',0,s],
  ['installation.updated',0,{version:'2.2.6'}],['installation.update-available',0,{version:'2.2.7'}],
  ['vcs.branch.updated',0,{branch:'main'}],['mcp.status.changed',0,{server:'example'}],['mcp.resources.changed',0,{server:'example'}],
];
const connected={id:'evt_connected',type:'server.connected',data:{},location};
const rpc={id:'evt_rpc',type:'rpc.example.changed',created:1,location,data:{opaque:{nested:[null,1,'x']}}};
function event([type,version,data],i=0) {
  return {id:`evt_${i}`,type,created:10-i/10,location:{...location,workspaceID:'workspace'},metadata:{opaque:true},data,
    ...(version?{durable:{aggregateID:type==='worktree.resolved'?data.projectID:data.sessionID,seq:i,version}}:{})};
}
const events=[connected,...rows.map(event),rpc];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(value,sse=false,limits={}) {
  let sent=false,pending;const resources=new Set();
  const stream={getReader:()=>({
    read(){if(!sent){sent=true;return Promise.resolve({done:false,value:new TextEncoder().encode(sse?value:JSON.stringify(value))});}
      return sse?new Promise(resolve=>{pending=resolve;}):Promise.resolve({done:true});},
    cancel(){pending?.({done:true});return Promise.resolve();},releaseLock(){},
  })};
  const client=makeCompletionReadClient({endpointLease:{origin:'http://127.0.0.1:43123',authorization:'Basic b3BlbmNvZGU6dGVzdA==',
    incarnationID:'fixture',sessionIDs:[sessionID],signal:new AbortController().signal,limits:{closeMs:50,...limits}},
    binding:{incarnationID:'fixture',sessionID,scope:{complete:true,serial:true,sessionIDs:[sessionID]}},
    transportOwner:{track(r){resources.add(r);return()=>resources.delete(r);}},
    fetchImpl:async()=>({status:200,headers:new Headers({'content-type':sse?'text/event-stream':'application/json'}),body:stream})});
  return {client,resources};
}
const frames=values=>values.map(v=>`data: ${JSON.stringify(v)}\n\n`).join('');
async function readEvents(values) {
  const f=fixture(frames(values),true),it=f.client.event.subscribe();const first=it.next();
  first.catch(()=>{}); // Own an invalid first-frame rejection while waiting for the pump to seal.
  await tick();await it.return();
  const result=[];try {let item=await first;while(!item.done){result.push(item.value);item=await it.next();}}
  catch(error) {if(values[0]===connected) assert.deepEqual(result,[connected]);throw error;}
  finally {assert.equal(f.resources.size,0);}
  return result;
}
test('all 98 source event variants and realistic mixed traffic survive the local seal in wire order',async()=>{
  assert.equal(events.length,98);assert.equal(new Set(events.map(e=>e.type)).size,98);
  const pick=type=>events.find(e=>e.type===type);
  const mixed=['server.connected','session.agent.selected','session.model.selected','session.instructions.updated',
    'session.inbox.delivered','session.execution.started','session.step.started','session.text.started','session.text.delta',
    'session.text.ended','session.tool.input.started','session.tool.input.delta','session.tool.input.ended','session.tool.called',
    'session.status','permission.asked','permission.replied','rpc.example.changed','session.tool.progress','session.tool.success',
    'session.step.streamed','session.step.ended','session.execution.succeeded'].map(pick);
  assert.deepEqual(await readEvents(mixed),mixed);
  assert.deepEqual(await readEvents(events),events);
});

const messageRows=[
  {type:'agent-switched',agent:'agent',previous:'old-agent'},
  {type:'model-switched',model,previous:{...model,variant:'old'}},
  {type:'location-switched',location,projectID:'project',subpath:'sub',previous:null},
  {type:'user',text:'question'},
  {type:'synthetic',text:'context',description:'automatic'},
  {type:'system',text:'system update',description:'instructions'},
  {type:'skill',skill:'skill',name:'example',text:'context'},
  {type:'shell',shellID:'shell_1',command:'example',status:'running'},
  {type:'assistant',agent:'agent',model,content:[{type:'text',text:'Hello 😀',native:{provider:{opaque:[null,1]}}}]},
  {type:'compaction',status:'running',reason:'auto',summary:'partial'},
  {type:'idle',outcome:'succeeded'},
  {type:'location-switched',location,previous:{location:{directory:'/old'},projectID:'old',subpath:'sub'}},
  ...['exited','timeout','killed'].map(status=>({type:'shell',shellID:'shell_1',command:'example',status,exit:0,output})),
  {type:'compaction',status:'completed',reason:'manual',summary:'summary',model,cost:0,tokens,native:{messages:[{arbitrary:true}]}},
  {type:'compaction',status:'failed',reason:'auto',error,cost:0,tokens},
].map((m,i)=>({id:`msg_${i}`,time:{created:20-i},metadata:{opaque:['retained',null]},...m}));
async function readPage(page,limits) {
  const f=fixture(page,false,limits);
  try {return await f.client.message.list({sessionID,limit:200,order:'desc'});}
  finally {assert.equal(f.resources.size,0);}
}
test('all 11 native message types and shell/compaction variants remain unchanged, even conflicting work',async()=>{
  assert.equal(new Set(messageRows.map(m=>m.type)).size,11);
  const page={data:messageRows,cursor:{previous:null,next:null}};
  assert.deepEqual(await readPage(page),page);
  // The adapter neither sorts timestamps nor infers work/idle boundaries across reads.
  for(const cursor of [{},{next:'opaque/+='},{previous:null}]) {
    const page={data:[messageRows[7],messageRows[10],messageRows[9]],cursor};
    assert.deepEqual(await readPage(page),page);
  }
});

test('every public event rejects malformed envelopes, native identities and durable versions without losing its prefix',async()=>{
  for(const original of events.slice(1)) {
    const invalid=[{...original,id:'not_native'},{...original,created:null},{...original,data:[]},
      {...original,metadata:[]},{...original,location:{directory:'relative'}},{...original,location:null}];
    if(original.durable) invalid.push({...original,durable:undefined},
      {...original,durable:{...original.durable,version:original.durable.version+1}},
      {...original,durable:{...original.durable,aggregateID:'wrong'}},
      ...[-1,0.5,Number.MAX_SAFE_INTEGER+1,'1',null].map(seq=>({...original,durable:{...original.durable,seq}})));
    else invalid.push({...original,durable:{aggregateID:'wrong',seq:1,version:1}});
    if(original.type!=='rpc.example.changed' && original.data.sessionID!==undefined)
      invalid.push({...original,data:{...original.data,sessionID:undefined}},{...original,data:{...original.data,sessionID:null}});
    for(const field of ['assistantMessageID','inboxID']) if(original.data[field]!==undefined)
      invalid.push({...original,data:{...original.data,[field]:'wrong'}},{...original,data:{...original.data,[field]:undefined}});
    for(const bad of invalid) await assert.rejects(readEvents([connected,bad]),/invalid_wire_shape/,original.type);
  }
});

test('RPC is exactly the declared wildcard envelope; unknown and replay-only schemas remain unsupported',async()=>{
  // Schema.TemplateLiteral(["rpc.", Schema.String]) includes an empty suffix.
  for(const type of ['rpc.','rpc.plugin.unlisted-name','rpc.session.execution.succeeded']) {
    const wire={...rpc,type,data:{sessionID:42,arbitrary:[null,{outcome:'succeeded'}]}};
    assert.deepEqual(await readEvents([connected,wire]),[connected,wire]);
  }
  for(const bad of [{...rpc,location:undefined},{...rpc,location:{...location,workspaceID:'private'}},
    {...rpc,created:undefined},{...rpc,data:null},{...rpc,data:'opaque'},
    {...connected,created:1},{...connected,durable:{}},{...connected,location:{...location,workspaceID:'private'}}])
    await assert.rejects(readEvents(bad.type==='server.connected'?[bad]:[connected,bad]),/invalid_wire_shape/);
  for(const type of ['rpc','RPC.example','unknown.type','session.usage.recorded','session.message.content.updated',
    'session.execution.unknown','server.unknown','__proto__','constructor'])
    await assert.rejects(readEvents([connected,{...rpc,type}]),/unsupported_event_type/);
  for(const data of [{...s,error:{}},{...s,error:null},{...s,error:{type:'x',message:2}}])
    await assert.rejects(readEvents([connected,event(['session.execution.failed',1,data])]),/invalid_wire_shape/);
  await assert.rejects(readEvents([connected,event(['session.execution.interrupted',1,{...s,reason:'done'}])]),/invalid_wire_shape/);
});

test('new message variants reject malformed required fields and unknown nested discriminants',async()=>{
  const bads=[
    {type:'agent-switched',agent:2},{type:'agent-switched',agent:'agent',previous:null},
    {type:'model-switched',model:{}},{type:'model-switched',model,previous:null},
    {type:'location-switched',location:{directory:'relative'}},{type:'location-switched',location,previous:{}},
    {type:'location-switched',location,previous:{location,subpath:5}},
    {type:'synthetic',text:1},{type:'system',text:null},{type:'system',text:'ok',description:3},
    {type:'skill',skill:'skill',name:4,text:'context'},{type:'skill',name:'name',text:'context'},
    {type:'shell',shellID:'shell',command:'x',status:'completed'},
    ...['Infinity','-Infinity','NaN',null].map(exit=>({type:'shell',shellID:'shell',command:'x',status:'exited',exit})),
    {type:'shell',shellID:'shell',command:'x',status:'running',output:{...output,truncated:0}},
    {type:'compaction',status:'unknown',reason:'auto',summary:'x'},
    {type:'compaction',status:'completed',reason:'unknown',summary:'x'},
    {type:'compaction',status:'running',reason:'auto'},
    {type:'compaction',status:'failed',reason:'auto',error:{}},
    {type:'compaction',status:'completed',reason:'auto',summary:'x',native:[]},
    {type:'compaction',status:'completed',reason:'auto',summary:'x',tokens:{...tokens,input:-1}},
  ];
  for(const m of bads) await assert.rejects(readPage({data:[{id:'msg_bad',time:{created:1},...m}],cursor:{}}),/invalid_wire_shape/);
  for(const m of messageRows) for(const change of [{id:'bad'},{time:null},{metadata:[]},{time:{created:null}}])
    await assert.rejects(readPage({data:[{...m,...change}],cursor:{}}),/invalid_wire_shape/);
  await assert.rejects(readPage({data:[{id:'msg_bad',type:'unknown',time:{created:1}}],cursor:{}}),/unsupported_message_type/);
});

test('opaque native payloads are retained but remain under the existing structural limits',async()=>{
  const opaque={...rpc,data:{unconsumed:{nested:{more:{value:1}}}}};
  assert.deepEqual(await readEvents([connected,opaque]),[connected,opaque]);
  const f=fixture(frames([connected,opaque]),true,{maxDepth:5}),it=f.client.event.subscribe();
  assert.deepEqual((await it.next()).value,connected);await tick();await it.return();
  await assert.rejects(it.next(),/json_structure_limit/);assert.equal(f.resources.size,0);
  await assert.rejects(readPage({data:[messageRows[8]],cursor:{}},{maxDepth:6}),/json_structure_limit/);
});
