// Restricted adapter for dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06.
// This is a local transport fence, not containment or native qualification.
const HARD = Object.freeze({maxBytes:4194304,maxFrameBytes:262144,maxEvents:10000,
  maxQueue:10000,maxDepth:64,maxNodes:100000,closeMs:1000});
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = v => typeof v === 'string' && v.length > 0 && v.length <= 512;
class ReadError extends Error {}
const fail = code => { throw new ReadError(code); };
const require = (yes, code='invalid_wire_shape') => { if (!yes) fail(code); };
const keys = (v, allowed, code='invalid_arguments') => require(object(v) &&
  Object.keys(v).every(k=>allowed.includes(k)),code);
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength').get;
const size = v => { require(v instanceof Uint8Array,'invalid_byte_chunk'); return byteLength.call(v); };
const safeError = e => e instanceof ReadError ? e : new ReadError('transport_failed');
const string = v => typeof v==='string';
const optional = (v,check) => v===undefined || check(v);
const msgID = v => id(v) && v.startsWith('msg_');
const shape = (v,allowed) => keys(v,allowed,'invalid_wire_shape');
function time(v,first,rest=[]) {
  shape(v,[first,...rest]);require(Number.isFinite(v[first]) && rest.every(k=>optional(v[k],Number.isFinite)));
}
function model(v) {
  shape(v,['id','providerID','variant']);require(id(v.id) && id(v.providerID) && optional(v.variant,string));
}
function location(v,internal=false) {
  shape(v,internal?['directory','workspaceID']:['directory']);
  require(string(v.directory) && v.directory.startsWith('/') && optional(v.workspaceID,id));
}
function structuredError(v) {
  shape(v,['type','message','status','response','retryAfterMs']);
  require(string(v.type) && string(v.message) && optional(v.status,Number.isFinite) && optional(v.retryAfterMs,Number.isFinite));
  if(v.response!==undefined) {shape(v.response,['body']);require(string(v.response.body));}
}
function tokens(v) {
  shape(v,['input','output','reasoning','cache']);shape(v.cache,['read','write']);
  require([v.input,v.output,v.reasoning,v.cache.read,v.cache.write].every(n=>Number.isFinite(n) && n>=0));
}
function mention(v) {
  shape(v,['start','end','text']);require(Number.isSafeInteger(v.start) && Number.isSafeInteger(v.end) &&
    v.start>=0 && v.end>=v.start && string(v.text));
}
function prompt(v) {
  require(string(v.text) && optional(v.metadata,object));
  for(const field of ['files','agents','skills']) if(v[field]!==undefined) {
    require(Array.isArray(v[field]));
    for(const a of v[field]) {
      if(field==='files') {
        shape(a,['data','mime','source','name','description','mention']);
        require(string(a.data) && string(a.mime) && optional(a.name,string) && optional(a.description,string));
        shape(a.source,['type','uri']);require(a.source.type==='inline' && a.source.uri===undefined ||
          a.source.type==='uri' && string(a.source.uri));
      } else if(field==='agents') {shape(a,['name','mention']);require(string(a.name));}
      else {shape(a,['id','name','text','mention']);require(id(a.id) && string(a.name) && optional(a.text,string));}
      if(a.mention!==undefined) mention(a.mention);
    }
  }
}
function content(v) {
  require(Array.isArray(v) && v.length>0);
  for(const c of v) {
    require(object(c));
    if(c.type==='text') {shape(c,['type','text']);require(string(c.text));}
    else {shape(c,['type','uri','mime','name']);require(c.type==='file' && string(c.uri) && string(c.mime) &&
      (c.name===null || optional(c.name,string)));}
  }
}
function assistantPart(p) {
  require(object(p));
  if(p.type==='text' || p.type==='reasoning') {
    shape(p,p.type==='text'?['type','text','native']:['type','text','native','time']);
    require(string(p.text) && optional(p.native,object));if(p.time!==undefined) time(p.time,'created',['completed']);return;
  }
  require(p.type==='tool','unsupported_message_content');
  shape(p,['type','id','name','executed','native','state','time']);
  require(id(p.id) && string(p.name) && optional(p.executed,v=>typeof v==='boolean') && optional(p.native,object));
  time(p.time,'created',['ran','completed']);const s=p.state;require(object(s));
  if(s.status==='streaming') {shape(s,['status','input']);require(string(s.input));return;}
  require(['running','completed','error'].includes(s.status));
  shape(s,['status','input','metadata',...(s.status==='error'?['error','content']:s.status==='completed'?['content']:[])]);
  require(object(s.input) && optional(s.metadata,object));
  if(s.status==='running') require(object(s.metadata));
  if(s.status==='completed' || s.content!==undefined) content(s.content);
  if(s.status==='error') structuredError(s.error);
}
function message(m) {
  require(object(m));
  require(['agent-switched','model-switched','location-switched','user','synthetic','system','skill','shell',
    'assistant','compaction','idle'].includes(m.type),'unsupported_message_type');
  require(msgID(m.id) && optional(m.metadata,object));
  const base=['id','type','metadata','time'];
  if(!['assistant','shell'].includes(m.type)) time(m.time,'created');
  if(m.type==='agent-switched') {
    shape(m,[...base,'agent','previous']);require(id(m.agent) && optional(m.previous,id));return;
  }
  if(m.type==='model-switched') {
    shape(m,[...base,'model','previous']);model(m.model);if(m.previous!==undefined) model(m.previous);return;
  }
  if(m.type==='location-switched') {
    shape(m,[...base,'location','projectID','subpath','previous']);
    const place=v=>{location(v.location);require(optional(v.projectID,id) && optional(v.subpath,string));};
    place(m);
    if(m.previous!==undefined && m.previous!==null) {shape(m.previous,['location','projectID','subpath']);place(m.previous);}
    return;
  }
  if(m.type==='synthetic' || m.type==='system') {
    shape(m,[...base,'text','description']);require(string(m.text) && optional(m.description,string));return;
  }
  if(m.type==='skill') {
    shape(m,[...base,'skill','name','text']);require(id(m.skill) && string(m.name) && string(m.text));return;
  }
  if(m.type==='shell') {
    shape(m,[...base,'shellID','command','status','exit','output']);time(m.time,'created',['completed']);
    require(id(m.shellID) && string(m.command) && ['running','exited','timeout','killed'].includes(m.status));
    require(optional(m.exit,Number.isFinite)); // Nonfinite encoded exits are explicitly unsupported.
    if(m.output!==undefined) {
      shape(m.output,['output','cursor','size','truncated']);require(string(m.output.output) &&
        Number.isFinite(m.output.cursor) && Number.isFinite(m.output.size) && typeof m.output.truncated==='boolean');
    }
    return;
  }
  if(m.type==='compaction') {
    require(['running','completed','failed'].includes(m.status) && ['auto','manual'].includes(m.reason));
    const extra=m.status==='running'?['summary']:m.status==='failed'?['error','cost','tokens']:['summary','model','native','cost','tokens'];
    shape(m,[...base,'status','reason',...extra]);
    if(m.status==='failed') structuredError(m.error);else require(string(m.summary));
    if(m.model!==undefined) model(m.model);require(optional(m.native,object));
    require(optional(m.cost,v=>Number.isFinite(v) && v>=0));if(m.tokens!==undefined) tokens(m.tokens);return;
  }
  if(m.type==='user') {shape(m,[...base,'text','files','agents','skills']);time(m.time,'created');prompt(m);return;}
  if(m.type==='idle') {
    shape(m,[...base,'outcome','error']);time(m.time,'created');
    require(['succeeded','failed','interrupted'].includes(m.outcome));if(m.error!==undefined) structuredError(m.error);return;
  }
  shape(m,[...base,'agent','model','content','snapshot','finish','rawFinish','native','cost','tokens','error','retry']);
  time(m.time,'created',['streamed','completed']);model(m.model);
  require(id(m.agent) && Array.isArray(m.content) && optional(m.native,object) && optional(m.rawFinish,string) &&
    optional(m.cost,v=>Number.isFinite(v) && v>=0) && optional(m.finish,v=>['stop','length','tool-calls','content-filter','error','unknown'].includes(v)));
  m.content.forEach(assistantPart);
  if(m.snapshot!==undefined) {shape(m.snapshot,['start','end','files']);require(optional(m.snapshot.start,id) && optional(m.snapshot.end,id) &&
    optional(m.snapshot.files,v=>Array.isArray(v) && v.every(string)));}
  if(m.tokens!==undefined) tokens(m.tokens);if(m.error!==undefined) structuredError(m.error);
  if(m.retry!==undefined) {shape(m.retry,['attempt','at','error']);require(Number.isSafeInteger(m.retry.attempt) && m.retry.attempt>0 &&
    Number.isSafeInteger(m.retry.at) && m.retry.at>=0);structuredError(m.retry.error);}
}
function job(j) {
  require(object(j) && ['shell','subagent','image'].includes(j.kind));
  const extra=j.kind==='shell'?['shellID','command']:j.kind==='subagent'?['childSessionID','agent','description']:['path','model'];
  shape(j,['id','sessionID','status','title','time','kind',...extra]);
  require(id(j.id) && id(j.sessionID) && ['running','completed','error','cancelled'].includes(j.status) &&
    optional(j.title,string) && extra.every(k=>string(j[k])));
  if(j.kind==='subagent') require(id(j.childSessionID));
  time(j.time,'started',['completed']);
}
function inboxItem(v) {
  require(['user','synthetic','compaction','move'].includes(v.type) && ['steer','queue'].includes(v.delivery));
  const p=v.payload;
  if(v.type==='user') {shape(p,['text','files','agents','skills','metadata']);prompt(p);}
  else if(v.type==='synthetic') {shape(p,['text','description','metadata']);require(string(p.text) && optional(p.description,string) && optional(p.metadata,object));}
  else if(v.type==='compaction') shape(p,[]);
  else {shape(p,['projectID','subpath','location']);require(id(p.projectID) && optional(p.subpath,string));location(p.location);}
}
function wire(value,kind) {
  shape(value,kind==='message'?['data','cursor']:['data']);
  if(kind==='active') {
    require(object(value.data));for(const [s,v] of Object.entries(value.data)) {require(id(s));shape(v,['type']);require(v.type==='running');}
  } else {
    require(Array.isArray(value.data));
    if(kind==='message') {
      require(value.data.length<=200);shape(value.cursor,['previous','next']);
      require(['previous','next'].every(k=>value.cursor[k]===null || optional(value.cursor[k],id)));
      value.data.forEach(message);
    } else if(kind==='job') value.data.forEach(job);
    else for(const v of value.data) {
      shape(v,['id','sessionID','time','type','payload','delivery']);require(msgID(v.id) && id(v.sessionID));
      time(v.time,'created');inboxItem(v);
    }
  }
  return kind==='message'?value:value.data;
}
// Public V2Event at dc2ffcf8, generated/types.ts:2845-2943 and
// schema/event-manifest.ts:72-82. Payloads outside the completion fields below
// remain opaque bounded JSON, not a claim of full native semantic validation.
const ephemeralEvents=new Set(`location.shutdown models-dev.refreshed credential.updated credential.switched
  integration.updated provider.updated model.updated agent.updated session.usage.updated
  session.text.delta session.reasoning.delta session.tool.input.delta session.tool.progress session.compaction.delta
  filesystem.changed reference.updated permission.asked permission.replied plugin.updated project.updated worktree.updated
  command.updated config.updated skill.updated pty.created pty.updated pty.exited pty.deleted
  persistent-pty.added persistent-pty.removed persistent-pty.updated shell.created shell.exited shell.deleted
  form.created form.replied form.cancelled websearch.updated artifact.updated session.status session.idle
  tui.prompt.append tui.command.execute tui.toast.show tui.session.select installation.updated installation.update-available
  vcs.branch.updated mcp.status.changed mcp.resources.changed`.split(/\s+/));
const durableV1=new Set(`session.created session.agent.selected session.model.selected session.moved session.renamed
  session.metadata.updated session.permissions session.viewed session.archived session.unarchived
  session.inbox.delivered session.inbox.enqueued session.inbox.cancelled session.inbox.delivery.changed
  session.execution.started session.execution.succeeded session.execution.failed session.execution.interrupted
  session.synthetic session.skill.activated session.shell.started session.shell.ended
  session.step.started session.step.streamed session.step.ended session.step.failed
  session.text.started session.text.ended session.reasoning.started session.reasoning.ended
  session.tool.input.started session.tool.input.ended session.tool.called session.retry.scheduled
  session.compaction.started session.compaction.ended session.compaction.failed
  session.revert.staged session.revert.cleared session.revert.committed worktree.resolved`.split(/\s+/));
const durableV2=new Set(`session.deleted session.forked session.instructions.updated session.tool.success session.tool.failed`.split(/\s+/));
function nativeEvent(e) {
  require(object(e) && id(e.id) && e.id.startsWith('evt_') && id(e.type) && object(e.data));
  if(e.type==='server.connected') {
    shape(e,['id','type','data','location','metadata']);shape(e.data,[]);
    if(e.location!==undefined) location(e.location);require(optional(e.metadata,object));return;
  }
  const rpc=e.type.startsWith('rpc.'); // The source declares this wildcard, not individual plugin names.
  const version=durableV2.has(e.type)?2:durableV1.has(e.type)?1:0;
  require(rpc || version || ephemeralEvents.has(e.type),'unsupported_event_type');
  shape(e,['id','type','created','data','location','metadata',...(version?['durable']:[])]);
  require(Number.isFinite(e.created) && optional(e.metadata,object));
  if(rpc) {location(e.location);return;}
  if(e.location!==undefined) location(e.location,true);
  const d=e.data;
  require(optional(d.sessionID,id));
  if(e.type.startsWith('session.') || e.type.startsWith('permission.') || e.type.startsWith('persistent-pty.') ||
    ['form.replied','form.cancelled','tui.session.select'].includes(e.type)) require(id(d.sessionID));
  if(/^session\.(step|text|reasoning|tool)\./.test(e.type) || e.type==='session.retry.scheduled') require(msgID(d.assistantMessageID));
  if(e.type.startsWith('session.inbox.')) require(msgID(d.inboxID));
  if(version) {
    shape(e.durable,['aggregateID','seq','version']);
    require(id(e.durable.aggregateID) && e.durable.aggregateID===(e.type==='worktree.resolved'?d.projectID:d.sessionID) &&
      Number.isSafeInteger(e.durable.seq) && e.durable.seq>=0 && e.durable.version===version);
  }
  const simple=['session.execution.started','session.execution.succeeded','session.inbox.delivered','session.inbox.cancelled',
    'session.execution.failed','session.execution.interrupted'];
  if(!simple.includes(e.type)) return;
  const extra=e.type.includes('.inbox.')?['inboxID']:e.type.endsWith('.failed')?['error']:e.type.endsWith('.interrupted')?['reason']:[];
  shape(d,['sessionID',...extra]);
  if(extra.includes('inboxID')) require(msgID(d.inboxID));
  if(extra.includes('error')) structuredError(d.error);
  if(extra.includes('reason')) require(['user','shutdown','superseded','inactivity'].includes(d.reason));
}

function parseJSON(text, cap) {
  let value;
  try { value=JSON.parse(text); } catch { fail('invalid_json'); }
  const stack=[[value,1]]; let nodes=0;
  while(stack.length) {
    const [v,depth]=stack.pop();
    require(++nodes<=cap.maxNodes && depth<=cap.maxDepth,'json_structure_limit');
    if(typeof v==='number') require(Number.isFinite(v),'invalid_wire_shape');
    if(v && typeof v==='object') for(const child of Object.values(v)) stack.push([child,depth+1]);
  }
  return value;
}

function eventParser(cap,emit) {
  let line=[],data=[],frameBytes=0,cr=false,seenConnected=false,count=0;
  const ids=new Set(),decoder=new TextDecoder('utf-8',{fatal:true});
  const endLine=()=>{
    let text;try {text=decoder.decode(new Uint8Array(line));} catch {fail('invalid_utf8');}
    line=[];
    if(text==='') {
      if(data.length) {
        const event=parseJSON(data.join('\n'),cap);
        nativeEvent(event);
        if(event.type==='server.connected') {require(!seenConnected,'event_reconnect');seenConnected=true;}
        else require(seenConnected,'connected_required');
        require(!ids.has(event.id),'event_replay');
        require(++count<=cap.maxEvents,'event_limit');
        ids.add(event.id);emit(event);
      }
      data=[];frameBytes=0;return;
    }
    if(text.startsWith(':')) return;
    require(text==='data' || text.startsWith('data:'),'unsupported_sse_field');
    data.push(text==='data'?'':text.slice(5).replace(/^ /,''));
  };
  const countByte=()=>require(++frameBytes<=Math.min(cap.maxFrameBytes,cap.maxBytes),'frame_byte_limit');
  return {
    push(chunk) {
      for(const b of chunk) {
        if(cr) {
          cr=false;
          if(b===10) {countByte();endLine();continue;}
          endLine();
        }
        countByte();
        if(b===13) cr=true;
        else if(b===10) endLine();
        else line.push(b);
      }
    },
    finish() {
      if(cr) {cr=false;endLine();}
      // Conservative even for a partial comment or unfinished UTF-8 sequence.
      require(frameBytes===0 && line.length===0 && data.length===0,'stream_partial_frame');
      line=[];data=[];
    },
    discardTail() {line=[];data=[];},
  };
}

/** Six reads only. The trusted launcher supplies the private lease and owner. */
export function makeCompletionReadClient({endpointLease,binding,fetchImpl,transportOwner}) {
  require(object(endpointLease) && object(binding),'invalid_endpoint_lease');
  const {origin,authorization,signal:leaseSignal,incarnationID}=endpointLease;
  require(typeof origin==='string' && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin) &&
    Number(origin.split(':').at(-1))<=65535,'invalid_endpoint_lease');
  require(typeof authorization==='string' && /^Basic [A-Za-z0-9+/]+={0,2}$/.test(authorization) &&
    authorization.length<=4096,'invalid_endpoint_lease');
  const credential=Buffer.from(authorization.slice(6),'base64');
  require(credential.toString('base64')===authorization.slice(6) && credential.length>9 &&
    credential.subarray(0,9).toString('ascii')==='opencode:' &&
    !credential.some(b=>b<32 || b===127),'invalid_endpoint_lease');
  require(leaseSignal instanceof AbortSignal && id(incarnationID) && incarnationID===binding.incarnationID,
    'invalid_endpoint_lease');
  require(Array.isArray(endpointLease.sessionIDs),'invalid_endpoint_lease');
  const sessions=[...endpointLease.sessionIDs];
  require(sessions.length>0 && sessions.length<=16 && sessions.every(s=>id(s) && s!=='.' && s!=='..' && s.isWellFormed()) && new Set(sessions).size===sessions.length &&
    binding.scope?.complete===true && binding.scope?.serial===true && sessions.includes(binding.sessionID) &&
    Array.isArray(binding.scope.sessionIDs) && sessions.length===binding.scope.sessionIDs.length &&
    new Set(binding.scope.sessionIDs).size===sessions.length && binding.scope.sessionIDs.every(s=>sessions.includes(s)),'invalid_endpoint_lease');
  require(typeof fetchImpl==='function' && typeof transportOwner?.track==='function','invalid_transport_owner');
  const cap={...HARD,...endpointLease.limits};
  for(const [k,v] of Object.entries(cap)) require(k in HARD && Number.isSafeInteger(v) && v>=1 && v<=HARD[k],'invalid_limits');
  const track=transportOwner.track.bind(transportOwner);
  const options = (v={}) => {
    keys(v,['signal','maxBytes']);
    require(v.signal===undefined || v.signal instanceof AbortSignal,'invalid_arguments');
    const maxBytes=v.maxBytes ?? cap.maxBytes;
    require(Number.isSafeInteger(maxBytes) && maxBytes>0 && maxBytes<=cap.maxBytes,'invalid_limits');
    return {signal:v.signal,maxBytes};
  };
  const session = (input, fields) => {
    keys(input,fields); require(id(input.sessionID) && sessions.includes(input.sessionID),'foreign_session');
    return encodeURIComponent(input.sessionID);
  };
  // One task owns fetch, its reader, and its cancellation. The public deadline
  // can fail before actual settlement; the owner then retains the exact handle.
  const exchange = (path,method,kind,o,consume,finish) => {
    const {signal,maxBytes}=o, controller=new AbortController(), reason=new Error('owned_read_cancel');
    let sealing=false,fenced=false,reader,cancelPromise,pump,timer,error,closeError,cleanupFailed=false,total=0,resolveDone,resolveSettled;
    const done=new Promise(resolve=>{resolveDone=resolve;});
    const settled=new Promise(resolve=>{resolveSettled=resolve;});
    const latch=e=>{if(!fenced && !error) error=safeError(e);};
    const cancel=()=>{
      if(reader && !cancelPromise) {
        // Attach an owner immediately, including for a synchronous throw.
        cancelPromise=Promise.resolve().then(()=>reader.cancel(reason)).catch(()=>{
          cleanupFailed=true;
          if(!fenced) {closeError=new ReadError('transport_teardown_failed');latch(closeError);}
        });
      }
    };
    const unlisten=()=>{leaseSignal.removeEventListener('abort',onLease);signal?.removeEventListener('abort',onAbort);};
    const seal = () => {
      if(sealing) return done;
      sealing=true;
      timer=setTimeout(()=>{
        closeError=new ReadError('transport_teardown_failed');latch(closeError);fenced=true;unlisten();resolveDone({error,closeError});
      },cap.closeMs);
      controller.abort(reason);cancel();
      // Run after pump assignment, and never wait for consumer FIFO drainage.
      Promise.resolve().then(async()=>{
        await pump;cancel();await cancelPromise;
        try {reader?.releaseLock();} catch {cleanupFailed=true;if(!fenced) {closeError=new ReadError('transport_teardown_failed');latch(closeError);}}
        unlisten();
        if(!cleanupFailed) try {release();} catch {cleanupFailed=true;if(!fenced) {closeError=new ReadError('transport_teardown_failed');latch(closeError);}}
        if(!fenced) {
          try {finish();} catch(e) {latch(e);}
          fenced=true;clearTimeout(timer);resolveDone({error,closeError});
        }
        resolveSettled({released:!cleanupFailed});
      }).catch(()=>{
        if(!fenced) {closeError=new ReadError('transport_teardown_failed');latch(closeError);
          fenced=true;clearTimeout(timer);unlisten();resolveDone({error,closeError});}
        resolveSettled();
      });
      return done;
    };
    const onAbort=()=>{if(kind!=='event') latch(new ReadError('read_aborted'));seal();};
    const onLease=()=>{latch(new ReadError('read_aborted'));seal();};
    const release=track(Object.freeze({abort:onLease,settled}));
    require(typeof release==='function','invalid_transport_owner');
    leaseSignal.addEventListener('abort',onLease,{once:true});signal?.addEventListener('abort',onAbort,{once:true});
    pump=Promise.resolve().then(async()=>{
      try {
        if(sealing) return;
        require(!leaseSignal.aborted && !signal?.aborted,'read_aborted');
        const response=await fetchImpl(origin+path,{method,redirect:'error',credentials:'omit',
          headers:{Authorization:authorization,Accept:kind==='event'?'text/event-stream':'application/json'},signal:controller.signal});
        reader=response.body?.getReader();
        if(sealing) {cancel();return;}
        require(response.redirected!==true,'redirect_refused');
        const status=response.status;
        require(Number.isInteger(status) && status>=100 && status<=599,'invalid_http_status');
        const good=status===(kind==='wait'?204:200);
        const length=response.headers.get('content-length');
        if(length!==null) require(/^\d+$/.test(length) && Number(length)<=maxBytes,'response_byte_limit');
        if(good && kind==='wait' && length!==null) require(Number(length)===0,'unexpected_response_body');
        if(good && kind!=='wait') require((kind==='event'?/^text\/event-stream(?:;\s*charset=utf-8)?$/i:
          /^application\/json(?:;\s*charset=utf-8)?$/i).test(response.headers.get('content-type') ?? ''),'unsupported_content_type');
        if(reader) while(!sealing) {
          const result=await reader.read();
          if(fenced) break; // Timed-out resource stays owned, but evidence is frozen.
          if(result.done) {
            if(kind==='event' && good && !sealing) fail('event_loss');
            break;
          }
          // A fulfilled issued read belongs to us, even after synchronous seal.
          total+=size(result.value);require(total<=maxBytes,'response_byte_limit');
          if(good) consume(result.value);
        }
        if(!good) fail(`http_status_${status}`);
        if(kind==='wait') require(total===0,'unexpected_response_body');
        if(kind==='event' && !reader) fail('event_loss');
      } catch(e) {if(e!==reason) latch(e);}
      finally {seal();}
    });
    if(leaseSignal.aborted) onLease();else if(signal?.aborted) {latch(new ReadError('read_aborted'));onAbort();}
    return {done,seal};
  };
  const finite = async (path,method,kind,rawOptions) => {
    const o=options(rawOptions), chunks=[];let total=0;
    const task=exchange(path,method,kind,o,chunk=>{chunks.push(chunk);total+=size(chunk);},()=>{});
    const {error,closeError}=await task.done;if(closeError || error) throw closeError || error;
    if(kind==='wait') return;
    const joined=new Uint8Array(total);let offset=0;
    for(const chunk of chunks) {joined.set(chunk,offset);offset+=size(chunk);}
    let text;try {text=new TextDecoder('utf-8',{fatal:true}).decode(joined);}catch {fail('invalid_utf8');}
    const value=parseJSON(text,cap);
    return wire(value,kind);
  };
  const subscribe = rawOptions => {
    const o=options(rawOptions), queue=[];
    let requested=false,started=false,closed=false,pending,task,closure,error;
    const deliver=()=>{
      if(!pending) return;
      const p=pending;
      if(queue.length) {pending=undefined;p.resolve({done:false,value:queue.shift()});}
      else if(closed) {pending=undefined;if(error) p.reject(error);else p.resolve({done:true,value:undefined});}
    };
    const parser=eventParser({...cap,maxBytes:o.maxBytes},event=>{
      require(queue.length<cap.maxQueue,'event_queue_limit');queue.push(event);deliver();
    });
    const start=()=>{
      started=true;
      task=exchange('/api/event','GET','event',o,chunk=>parser.push(chunk),()=>parser.finish());
      task.done.then(result=>{parser.discardTail();error=result.error || result.closeError;closed=true;deliver();});
    };
    const iterator={
      [Symbol.asyncIterator]() {require(!requested && !started,'single_consumer');requested=true;return this;},
      next() {
        if(pending) return Promise.reject(new ReadError('parallel_next'));
        const value=new Promise((resolve,reject)=>{pending={resolve,reject};});
        if(!started && !closed) start();deliver();return value;
      },
      return() {
        if(closure) return closure;
        if(!started) {closed=true;closure=Promise.resolve({done:true,value:undefined});}
        else closure=task.seal().then(result=>{if(result.closeError) throw result.closeError;return {done:true,value:undefined};});
        // Abort can close without a caller awaiting return. Always own rejection.
        closure.catch(()=>{});deliver();return closure;
      },
    };
    return Object.freeze(iterator);
  };
  return Object.freeze({
    event:Object.freeze({subscribe}),
    message:Object.freeze({list:async(input,o)=>{
      const s=session(input,['sessionID','limit','order','cursor']);
      require(input.limit===200 && (input.cursor===undefined?input.order==='desc':id(input.cursor) && input.order===undefined));
      const query=new URLSearchParams({limit:'200',...(input.cursor===undefined?{order:'desc'}:{cursor:input.cursor})});
      return finite(`/api/session/${s}/message?${query}`,'GET','message',o);
    }}),
    experimental:Object.freeze({
      session:Object.freeze({wait:async(input,o)=>finite(`/api/experimental/session/${session(input,['sessionID'])}/wait`,'POST','wait',o)}),
      job:Object.freeze({list:async(input,o)=>{
        session(input,['sessionID','descendants']);require(input.descendants===true,'invalid_arguments');
        return finite(`/api/experimental/job?${new URLSearchParams({sessionID:input.sessionID,descendants:'true'})}`,'GET','job',o);
      }}),
    }),
    session:Object.freeze({
      inbox:Object.freeze({list:async(input,o)=>finite(`/api/session/${session(input,['sessionID'])}/inbox`,'GET','inbox',o)}),
      active:async(input,o)=>{require(input===undefined,'invalid_arguments');return finite('/api/session/active','GET','active',o);},
    }),
  });
}
