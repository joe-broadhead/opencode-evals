// Pure finite fake service. Only request() changes owned state. Never imports a plugin or contacts a service.
import {isDeepStrictEqual as equal} from "node:util"
import {canonicalDiscoveryInput,validDiscoveryReadInput} from "./discovery-input.mjs"
import {createHash} from "node:crypto"
const copy=v=>structuredClone(v)
const plain=v=>Boolean(v&&typeof v==="object"&&!Array.isArray(v))
// The first plain line of a body, cut at a word — the real records service's
// titleFromBody (records/src/text.js:71-88: wiki-link and markdown noise stripped,
// then cut at a word, text.js:97-103).
const plainLine=line=>String(line).replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g,"$2").replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\]\]/g,"$1").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s+|\d+\.\s+)/,"").replace(/[*_`]+/g,"").trim()
const cutText=(text,max)=>{const value=String(text??"");if(value.length<=max)return value;const head=value.slice(0,max-1);const space=head.lastIndexOf(" ");return `${(space>max*0.6?head.slice(0,space):head).trimEnd()}…`}
const titleFromBody=(body,max)=>{for(const line of String(body??"").split("\n")){const text=plainLine(line);if(text)return cutText(text,max)}return ""}
// The public commitment row the real records service derives from the stored body,
// never echoing the wire: newRecord defaults type to "commitment" (records/src/
// model.js:293) and the title to fields.what, else the body's first plain line cut
// to 300 (model.js:305-307); commitmentFields back-fills fields.what from that
// title with the owner:"user"/state:"open" bookkeeping (model.js:276-285); the
// stated_by default is the writer's own "agent" (model.js:270-275); #create stamps
// id/status:"current"/version:1 (records/src/store.js:3816-3832) and pub() exposes
// the row (store.js:1411-1433). Mutates the row in place.
const commitmentPubRow=record=>{
  if(record.type===undefined)record.type="commitment"
  if(!record.title)record.title=typeof record.fields?.what==="string"?record.fields.what:titleFromBody(record.body,300)
  const fields={...(record.fields??{})}
  if(!fields.what&&record.title)fields.what=record.title
  if(fields.owner===undefined)fields.owner="user"
  if(fields.state===undefined)fields.state="open"
  record.fields=fields
  if(record.stated_by===undefined)record.stated_by="agent"
  return record
}
export function createDiscoveryStore({spec,intent,permission={effect:"allow"},fault:configuredFault=null}){
  if(!spec?.backend||intent?.schema!=="oc-mem-intent/1"||intent.case_id!==spec.id||typeof intent.trial_id!=="string"||!intent.trial_id||!Number.isFinite(intent.expires_at)||!Array.isArray(intent.turns)||intent.turns.length!==1||intent.turns[0]?.index!==1||!Array.isArray(intent.turns[0].calls))throw new Error("bound discovery plan required")
  if(!["allow","deny","ask-approved","ask-declined"].includes(permission.effect))throw new Error("invalid fake permission condition")
  const before=copy(spec.seed),after=copy(before),requests=[],creators=[]
  let closed=false,session=null
  // Context is supplied by the native owner, never recovered from a prior request or a body/header.
  // This finite one-turn store cannot switch sessions once a legitimate native lifetime is established.
  function checkLifetime(context){
    if(closed)return {status:409,json:{error:{code:"store_closed"}}}
    if(context?.active!==true||context.case_id!==spec.id||context.trial_id!==intent.trial_id||context.turn!==1||!intent.turns?.some(t=>t.index===context.turn)||typeof context.session!=="string"||!context.session||!Number.isFinite(intent.expires_at)||intent.expires_at<=Date.now()||session!==null&&context.session!==session)return {status:403,json:{error:{code:"intent_denied"}}}
    if(!["allow","ask-approved"].includes(permission.effect))return {status:403,json:{error:{code:"permission_denied"},status:"denied"}}
    session=context.session
    return {status:200}
  }
  const view=()=>({schema:"oc-mem-capture/1",fixture:"mem-synthetic-v1",before:copy(before),after:copy(after),requests:copy(requests),discovery:{schema:"oc-mem-discovery-proof/1",suite:spec.suite,case_id:spec.id,trial_id:intent.trial_id,permission:copy(permission),before:copy(before),state:copy(after),requests:copy(requests),creators:copy(creators),turns:[]}})
  function request(method,input,{space="personal",context=null,invocation=null}={}){
    if(closed)return {status:409,json:{error:{code:"store_closed"}}}
    const fault=method===spec.backend.method?configuredFault:null
    const wire_input=copy(input)
    input=canonicalDiscoveryInput(method,input,context)
    let status=200,out={},state=after[space],write=["records.put","wiki.raw.write","sources.request","plugins.request","jobs.draft"].includes(method)
     const finish=(result,code=status)=>{const value=copy(result);requests.push({method,verb:"POST",space,input:copy(input),wire_input,output:value,status:code===200?(write?(value.status??"stored"):"read"):code===404||code===409?"unsupported":"denied",http_status:code,context:copy(context)});return {status:code,json:value}}
     const lifetime=checkLifetime(context)
     if(lifetime.status!==200)return finish(lifetime.json,lifetime.status)
     if(invocation&&(invocation.pass!==true||invocation.active!==true||invocation.case_id!==context.case_id||invocation.trial_id!==context.trial_id||invocation.turn!==context.turn||invocation.session!==context.session))return finish({error:{code:"invocation_denied"}},403)
    if(!state)return finish({error:{code:"scope_denied"}},403)
    if(!plain(input))return finish({error:{code:"invalid_input"}},400)
    if(method.startsWith("wiki.")&&method!=="wiki.list"&&input.wiki_id!==`wiki-eval-${space}`)return finish({error:{code:"resource_not_visible"}},404)
    if(method.startsWith("code-graph.")&&method!=="code-graph.list"&&!state.codeGraphs.some(g=>g.id===input.code_graph_id))return finish({error:{code:"resource_not_visible"}},404)
    if(["sources.bind","sources.report","jobs.activate","jobs.run","jobs.resume","jobs.delete","jobs.archive"].includes(method))return finish({error:{code:"human_proof_required"}},403)
    const reads=["records.get","records.list","records.search","wiki.raw.read","wiki.raw.list","wiki.page.read","wiki.page.ls","wiki.graph","wiki.list","wiki.get","knowledge.list","meta.asset.list-accessible","meta.asset.touch-usage","meta.agent.list","meta.team-member.list","code-graph.callers","code-graph.get","code-graph.status","code-graph.files","code-graph.node","code-graph.callees","code-graph.impact","code-graph.explore","code-graph.list","code-graph.search","skill.list","skill.get","skill.search","skill.versions","sources.list","plugins.list","jobs.templates","jobs.list","jobs.get","jobs.versions","jobs.runs","jobs.logs","jobs.diff","jobs.items","jobs.hosts","wiki.ingest"]
    if(!write&&!reads.includes(method))return finish({error:{code:"unsupported_operation"}},404)
    if(!write&&!validDiscoveryReadInput(method,input))return finish({error:{code:"invalid_read_input"}},400)
    if(fault==="unsupported")return finish({error:{code:"unsupported_operation"}},409)
    if(fault==="denied")return finish({error:{code:"policy_denied"}},403)
     if(write){
      const expected=intent.turns[0].calls.find(c=>c.family===spec.binding.tool&&equal(c.args,invocation?.args))
       if(!spec.write||space!=="personal"||!expected||invocation?.case_id!==spec.id||invocation?.trial_id!==intent.trial_id||invocation?.turn!==1||invocation?.session!==context.session||String(invocation?.tool).replace(/^mem\./,"mem_")!==`mem_${spec.binding.tool}`||!invocation.pass||method!==spec.backend.method||!equal(input,spec.backend.input))return finish({error:{code:"intent_denied"}},403)
      if(["queued","partial","noop"].includes(fault))return finish({status:fault})
      if(method==="records.put"){
        const record={...copy(wire_input.record),...copy(input.record),id:"rec_01KABCDE1234567890ABCDEFGK",status:"current",version:1}
        // LEG D (the round-5 diagnosis): the real records service derives a
        // commitment's public row from the stored body rather than echoing the wire,
        // so a reduced wire still gets the full row the real arm client's
        // validWriteAnswer accepts (arm src/backend/records.js record()). A wire that
        // already carries the fields — the real plugin's commitmentRecord (arm
        // src/records-store.js) — is answered byte-identically. The capture's closed
        // vocabulary (src/grade/adapters/mem-discovery.mjs:294) admits exactly these
        // public fields and excludes the service-internal bookkeeping (path/
        // supersedes/superseded_by/task/author/owner/created/updated/links), so the
        // graded row mirrors pub()'s derivation up to that contract edge.
        if(record.kind==="commitment")commitmentPubRow(record)
        if(fault==="metadata-only"){record.title=record.body;record.body="No authorized body was stored."}
        state.records.push(record);out={status:"stored",created:true,record}
      }else if(method==="wiki.raw.write"){
        for(const f of input.files)state.raw[f.filename]=fault==="metadata-only"?"No authorized body was stored.":f.content
        out={status:"stored",items:input.files.map(f=>({filename:f.filename,status:"written"}))}
      }else if(method==="sources.request"){
        const request={id:"request-fixture-1",...input,state:fault==="metadata-only"?"metadata-only":"requested"};state.sourceRequests.push(request);out={status:"stored",request}
      }else if(method==="jobs.draft"){
        const job={id:"job-fixture-1",...input,status:fault==="metadata-only"?"active":"draft",active:fault==="metadata-only",next_due:null,version:1};state.jobs.push(job);out={status:"stored",job,draft:{version:1,state:"draft"}}
      }
      const id=out.record?.id??out.job?.id??out.request?.id
      if(id)creators.push({id,case_id:spec.id,trial_id:intent.trial_id,turn:1,session:context.session,tool:invocation.tool,args:copy(invocation.args),status:"stored"})
      return finish(out)
    }
    if(method==="records.get")out={records:state.records.filter(r=>input.ids?.includes(r.id)),missing:(input.ids??[]).filter(id=>!state.records.some(r=>r.id===id))}
    if(method==="records.list"){
      const limit=input.limit??20;if(!Number.isInteger(limit)||limit<1||limit>100)return finish({error:{code:"invalid_limit"}},400)
      const query=Object.fromEntries(Object.entries(input).filter(([k])=>k!=="cursor").sort(([a],[b])=>a.localeCompare(b))),key=createHash("sha256").update(JSON.stringify(query)).digest("hex").slice(0,16)
      const offset=input.cursor?Number(String(input.cursor).split(":").at(-1)):0
      const records=state.records.filter(r=>(!input.kind||[input.kind].flat().includes(r.kind))&&(!input.type||[input.type].flat().includes(r.type))&&(!input.status||input.status==="all"||r.status===input.status)&&(!input.prefix||r.path?.startsWith(input.prefix)))
      if(!Number.isInteger(offset)||offset<0||offset>records.length||input.cursor&&input.cursor!==`discovery:${space}:${key}:${offset}`)return finish({error:{code:"invalid_cursor"}},400)
      out={records:records.slice(offset,offset+limit),cursor:offset+limit<records.length?`discovery:${space}:${key}:${offset+limit}`:null,more:offset+limit<records.length}
    }
    if(method==="records.search")out={hits:state.records.filter(r=>(!input.kinds||input.kinds.includes(r.kind))&&(!input.types||input.types.includes(r.type))&&(!input.status||input.status==="all"||input.status===r.status)&&`${r.title} ${r.body}`.toLowerCase().includes(String(input.query).toLowerCase())).slice(0,input.limit??20).map(({body,...r})=>({...r,snippet:body.slice(0,28)}))}
    if(method==="wiki.raw.read")out={items:(input.filenames??[]).filter(f=>Object.hasOwn(state.raw,f)).map(filename=>({filename,content:state.raw[filename]}))}
    if(method==="wiki.raw.list")out={items:Object.keys(state.raw).map(filename=>({filename}))}
    if(method==="wiki.get")out={wiki_id:space==="personal"?"wiki-eval-personal":"wiki-eval-shared",name:"Quartz wiki",status:"ready",type:"llm_wiki"}
    if(method==="wiki.ingest"){
      // Finite deterministic Markdown projection only, after this case's actual source write. No arbitrary ingestion.
      if(spec.family!=="wiki-write"||space!=="personal"||!equal(input,{wiki_id:"wiki-eval-personal"})||!requests.some(r=>r.method==="wiki.raw.write"&&r.status==="stored"))return finish({error:{code:"ingest_not_authorized"}},403)
      out={wiki_id:"wiki-eval-personal",status:"ready"}
    }
    if(method==="wiki.page.ls")out={items:Object.keys(state.raw).map(filename=>({id:filename,path:`wiki/${filename}`,title:filename,type:"other",locked:false}))}
    if(method==="wiki.page.read")out={items:(input.refs??[]).map(ref=>{const filename=String(ref).replace(/^wiki\//,"");return Object.hasOwn(state.raw,filename)?{ref,content:state.raw[filename]}:{ref,not_found:true}})}
    if(method==="wiki.graph")out=state.wikiGraphs.find(g=>g.id===input.wiki_id)??{nodes:[],edges:[],communities:[]}
    if(method==="wiki.list")out={items:[{wiki_id:space==="personal"?"wiki-eval-personal":"wiki-eval-shared",name:"Quartz wiki",type:"llm_wiki"}]}
    if(method==="code-graph.list")out={items:state.codeGraphs.map(g=>({code_graph_id:g.id,name:g.name}))}
    if(method==="knowledge.list")out={items:[{knowledge_id:space==="personal"?"wiki-eval-personal":"wiki-eval-shared",name:"Quartz wiki",type:"llm_wiki",status:"ready"},...state.codeGraphs.map(g=>({knowledge_id:g.id,name:g.name,type:"code_graph",status:"ready"}))].filter(i=>!input.type||i.type===input.type)}
    if(method==="meta.asset.list-accessible")out={items:[{asset_id:`asset-${space}-wiki`,asset_type:"llm_wiki",content_ref:space==="personal"?"wiki-eval-personal":"wiki-eval-shared",name:"Quartz wiki",visibility:space==="personal"?"private":"team",owner_user_id:"eval",team_id:`eval-container-${space}`,status:"approved"},...state.codeGraphs.map(g=>({asset_id:`asset-${g.id}`,asset_type:"code_graph",content_ref:g.id,name:g.name,team_id:`eval-container-${space}`,owner_user_id:"eval",visibility:"private",status:"approved"}))]}
    if(method==="meta.asset.list-accessible")out.items=out.items.filter(i=>!input.asset_type||i.asset_type===input.asset_type)
    if(method==="meta.asset.touch-usage")out={asset_id:input.asset_id,usage_count:1}
    if(method==="meta.agent.list"||method==="meta.team-member.list")out={items:[]}
    if(method==="code-graph.search")out={nodes:(state.codeGraphs.find(g=>g.id===input.code_graph_id)?.nodes??[]).filter(n=>`${n.id} ${n.name}`.toLowerCase().includes(input.query.toLowerCase())).slice(0,input.limit??20)}
    if(method==="code-graph.get"||method==="code-graph.status")out={code_graph_id:input.code_graph_id,status:state.codeGraphs.some(g=>g.id===input.code_graph_id)?"ready":"not_found"}
    if(method==="code-graph.files")out={items:[],partial:false}
    if(["code-graph.node","code-graph.callees","code-graph.impact","code-graph.explore"].includes(method)){const g=state.codeGraphs.find(g=>g.id===input.code_graph_id);out={nodes:g?.nodes??[],edges:g?.edges??[],bounded:true}}
    if(method==="code-graph.callers"){
      const g=state.codeGraphs.find(g=>g.id===input.code_graph_id),edges=g?.edges.filter(e=>e.target===input.symbol)??[];out={nodes:g?.nodes.filter(n=>edges.some(e=>e.source===n.id))??[],edges}
    }
    if(method==="skill.list"||method==="skill.search")out={items:state.skills.filter((s,i,a)=>a.findLastIndex(v=>v.skill_id===s.skill_id)===i).filter(s=>method!=="skill.search"||`${s.name} ${s.description}`.toLowerCase().includes(input.query.toLowerCase())).slice(input.pagination?.offset??0,(input.pagination?.offset??0)+(input.pagination?.limit??input.top_k??100)).map(({content,...summary})=>summary)}
    if(method==="skill.get")out=state.skills.findLast(s=>s.skill_id===input.skill_id)??{}
    if(method==="skill.versions"){
      if(input.pagination?.limit!==50||!Number.isInteger(input.pagination?.offset)||input.pagination.offset<0||Object.keys(input.pagination).some(k=>!["limit","offset"].includes(k))||typeof input.skill_id!=="string")return finish({error:{code:"invalid_skill_pagination"}},400)
      out={items:state.skills.filter(s=>s.skill_id===input.skill_id).slice(input.pagination.offset,input.pagination.offset+50).map(({content,...summary})=>summary)}
    }
    if(method==="sources.list")out={sources:copy([...state.providers,...state.bindings]),requests:copy(state.sourceRequests)}
    if(method==="plugins.list")out={plugins:[],requests:[]}
    if(method==="jobs.templates")out={templates:copy(state.templates)}
    if(method==="jobs.list")out={jobs:copy(state.jobs)}
    const job=method.startsWith("jobs.")?state.jobs.find(j=>j.id===input.job_id):null
    if(["jobs.get","jobs.versions","jobs.diff","jobs.runs","jobs.logs","jobs.items"].includes(method)&&(!job||input.version!==undefined&&input.version!==job.version))return finish({error:{code:"job_not_found"}},404)
    if(method==="jobs.get")out={job:copy(job)}
    if(method==="jobs.versions")out={versions:[{version:job.version,state:job.status}]}
    if(method==="jobs.runs")out={runs:[]}
    if(method==="jobs.logs")out={logs:[]}
    if(method==="jobs.items")out={items:[]}
    if(method==="jobs.hosts")out={hosts:[]}
    if(method==="jobs.diff")out={version:{version:job.version,state:job.status,base:0,diff:[]},widening:false}
    if(fault==="noop")out={}
    if(fault==="partial")out={...out,partial:true,cursor:"truncated"}
    if(fault==="queued")out={status:"queued"}
    if(fault==="metadata-only")out={title:JSON.stringify(out),metadata_only:true}
    return finish(out)
  }
   return {request,checkLifetime,capture:view,close(){closed=true}}
}
