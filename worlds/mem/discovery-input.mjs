// Canonical records wire projection. Only source-owned metadata may differ; content/targets never do.
const plain=v=>Boolean(v&&typeof v==="object"&&!Array.isArray(v))
const closed=(v,keys)=>plain(v)&&Object.keys(v).every(k=>keys.includes(k))
const text=(v,max=4096)=>typeof v==="string"&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v)
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max
const strings=v=>Array.isArray(v)&&v.length>0&&v.length<=50&&v.every(x=>text(x,300))
const optional=(v,test)=>v===undefined||test(v)
const pagination=(v,limit)=>closed(v,["limit","offset"])&&integer(v.limit,1,limit)&&integer(v.offset,0,100000)
// This is the finite fake's supported wire subset, not a new public Memory schema.
// The records read subset mirrors the real records service's read contract, so
// a wire the real service answers is never the thing a trial fails on: the
// round-6 diagnosis found five live trials refused at records.list
// {kind:"commitment",status:"all",limit:200,full:true} (the real plugin's
// listRecords wire, arm src/records-store.js:78) and records.get
// {paths:["index"]} (the real plugin's readIndex, arm src/records-store.js
// readIndex, and mem_page path refs, arm src/tools/page.js getPage:192) —
// both answered by the real service.
// The record statuses the real service filters by (records/src/model.js:19).
const STATUSES=["current","superseded","retired","contested","proposed","accepted","rejected","accepting","applied","applied_private","declined"]
// The record model's kind→type sets, mirrored from records/src/model.js:13-18.
const KINDS={memory:["fact","preference","constraint","decision","procedure"],page:["person","project","team","topic","runbook","decision","glossary","journal","index","meeting"],commitment:["commitment"],proposal:["create","append","supersede","merge","link","close_commitment","open_commitment","share","team_write"]}
// The real stringList: a bare string or a list of at most `max` (records/src/store.js:1483-1494).
const stringList=(v,max=20)=>text(v)||Array.isArray(v)&&v.length>0&&v.length<=max&&v.every(x=>text(x,300))
// stringList's allowed check (store.js:1490-1493): every item inside the set the
// real parse allows — kind against Object.keys(KINDS), type against the flattened
// type set, exactly as the real records.list parse refuses them (store.js:4136-4137).
const allowedList=(v,allowed)=>stringList(v)&&(typeof v==="string"?allowed.includes(v):v.every(x=>allowed.includes(x)))
const KIND_SET=Object.keys(KINDS)
const TYPE_SET=[...new Set(Object.values(KINDS).flat())]
// The record model's PATH (records/src/links.js:8): lowercase alnum-hyphen
// segments of at most 64 characters, at most four, no slash at either end.
const PATH=/^[a-z0-9][a-z0-9-]{0,63}(?:\/[a-z0-9][a-z0-9-]{0,63}){0,3}$/
export function validDiscoveryReadInput(method,v){
  if(!plain(v))return false
  // records.get `{ids?, paths?}` (records/src/store.js:4104-4113): two lists of
  // strings, at least one id or path together, at most 50 together. Any string
  // is taken — an unknown id or path comes back in `missing` (store.js:4118-4128)
  // — so the rec_ form is a resolution outcome, not a validation rule.
  if(method==="records.get"){const count=(v.ids?.length??0)+(v.paths?.length??0);return closed(v,["ids","paths"])&&optional(v.ids,strings)&&optional(v.paths,strings)&&count>=1&&count<=50}
  // records.list (records/src/store.js:4132-4185): kind and type a bare string or
  // a list of at most 20, every item inside the record model's own sets — kind
  // against Object.keys(KINDS), type against the flattened type set — refused by
  // the real parse itself through stringList's allowed check (store.js:4136-4137,
  // 1483-1494; KINDS, records/src/model.js:13-18); status "all" (every status,
  // store.js:1521), "current" (the default view, store.js:1522) or a list of at
  // most 20 of the record statuses (stringList's own cap, store.js:1486, via
  // statusFilter store.js:1523); limit a whole number from 1 to 200 (intInRange,
  // store.js:4140); the cursor the service's own (store.js:4141 — the store below
  // decodes it and refuses a foreign one as invalid_cursor); and the path prefix
  // the real form (checkPrefix, store.js:1496-1503, with the record model's PATH,
  // records/src/links.js:8): an empty prefix is absent, one trailing slash is
  // stripped, and any bare form the PATH rules refuse is refused here too.
  // Two boundaries here are the FIXTURE's closed-subset design, not the real
  // validator's: the real parse tests `full === true` and never refuses a
  // non-boolean `full` (store.js:4181 — full:"yes" merely cuts the bodies), and
  // requireObject passes unknown fields straight through (store.js:1712-1715);
  // this fixture keeps its boolean-only `full` and its closed key set. `prefix`
  // stays accepted as the fixture's own subset key it already was. The selection
  // filters (SELECTION_FILTERS, store.js:1532) are closed BY DESIGN: the finite
  // store cannot honor them — it keeps none of their data (no created/updated
  // stamps, no agents or tasks) — so accepting them would answer a filter the
  // store cannot apply, and they refuse here. That closure is deliberate, with a
  // known residual live-trial risk stated plainly: the guard admits mem_recall
  // with filter args (a read, no sealed payload check), and a recall path CAN
  // spread those args into a records.list wire the real service accepts
  // (selectionClauses, store.js:1532+) — such a wire refuses at this fixture.
  // No plugin wire in the recorded trials and no graded case carries them; the
  // closure is unchanged.
  if(method==="records.list")return closed(v,["kind","type","status","limit","cursor","prefix","path_prefix","full"])&&optional(v.kind,x=>allowedList(x,KIND_SET))&&optional(v.type,x=>allowedList(x,TYPE_SET))&&optional(v.status,x=>x==="all"||x==="current"||Array.isArray(x)&&x.length>0&&x.length<=20&&x.every(s=>STATUSES.includes(s)))&&optional(v.limit,x=>integer(x,1,200))&&optional(v.cursor,text)&&optional(v.prefix,text)&&optional(v.path_prefix,x=>x===""||PATH.test(String(x).replace(/\/$/,"")))&&optional(v.full,x=>x===true||x===false)
  if(method==="records.search")return closed(v,["query","kinds","types","status","limit"])&&text(v.query)&&optional(v.kinds,strings)&&optional(v.types,strings)&&optional(v.status,x=>["current","all"].includes(x))&&optional(v.limit,x=>integer(x,1,50))
  if(method==="wiki.raw.read")return closed(v,["wiki_id","filenames"])&&text(v.wiki_id,200)&&strings(v.filenames)&&v.filenames.every(f=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(f))
  if(["wiki.raw.list","wiki.graph","wiki.get","wiki.ingest","wiki.page.ls"].includes(method))return closed(v,["wiki_id"])&&text(v.wiki_id,200)
  if(method==="wiki.page.read")return closed(v,["wiki_id","refs"])&&text(v.wiki_id,200)&&strings(v.refs)
  if(method==="knowledge.list")return closed(v,["type"])&&optional(v.type,x=>["llm_wiki","code_graph"].includes(x))
  if(method==="wiki.list")return closed(v,[])
  if(method==="skill.list")return closed(v,["filters","pagination"])&&optional(v.filters,x=>closed(x,[]))&&optional(v.pagination,x=>pagination(x,100))
  if(method==="skill.get")return closed(v,["skill_id","include_content"])&&text(v.skill_id,200)&&optional(v.include_content,x=>x===true)
  if(method==="skill.search")return closed(v,["query","top_k"])&&text(v.query,2048)&&optional(v.top_k,x=>x===20)
  if(method==="skill.versions")return closed(v,["skill_id","pagination"])&&text(v.skill_id,200)&&pagination(v.pagination,50)&&v.pagination.limit===50
  if(method==="meta.asset.list-accessible")return closed(v,["asset_type"])&&optional(v.asset_type,text)
  if(method==="meta.asset.touch-usage")return closed(v,["asset_id"])&&text(v.asset_id,200)
  if(["meta.agent.list","meta.team-member.list","code-graph.list"].includes(method))return closed(v,["filters","pagination"])&&optional(v.filters,x=>closed(x,[]))&&optional(v.pagination,x=>pagination(x,100))
  if(method.startsWith("code-graph.")){
    const op=method.slice(11),keys=["code_graph_id",...(op==="search"?["query","limit"]:op==="explore"?["query","maxFiles"]:["node","callers","callees","impact"].includes(op)?["symbol",...(op==="impact"?["depth"]:[])]:op==="files"?["format","maxDepth"]:[])]
    return closed(v,keys)&&text(v.code_graph_id,128)&&optional(v.query,x=>text(x,300))&&(!["search","explore"].includes(op)||text(v.query,op==="search"?200:300))&&optional(v.limit,x=>integer(x,1,20))&&optional(v.symbol,x=>text(x,300))&&(!["node","callers","callees","impact"].includes(op)||text(v.symbol,300))&&optional(v.depth,x=>integer(x,1,5))&&optional(v.maxFiles,x=>x===12)&&optional(v.maxDepth,x=>x===4)&&optional(v.format,x=>x==="tree")
  }
  if(["sources.list","plugins.list","jobs.templates","jobs.hosts"].includes(method))return closed(v,[])
  if(method==="jobs.list")return closed(v,["cursor","limit"])&&optional(v.cursor,text)&&optional(v.limit,x=>integer(x,1,100))
  if(["jobs.get","jobs.versions","jobs.diff","jobs.runs","jobs.logs","jobs.items"].includes(method))return closed(v,["job_id","version","limit","cursor"])&&text(v.job_id,200)&&optional(v.version,x=>integer(x,1,100000))&&optional(v.limit,x=>integer(x,1,100))&&optional(v.cursor,text)
  return false
}
export function canonicalDiscoveryInput(method,input,context){
  if(method!=="records.put")return structuredClone(input)
  if(!closed(input,["record","upsert_path"])||!closed(input.record,["kind","type","body","path","title","stated_by","source","fields"]))return null
  const r=input.record
  if(input.upsert_path!==undefined&&(r.kind!=="page"||input.upsert_path!==true)||r.title!==undefined&&(typeof r.title!=="string"||r.title.length>200)||r.stated_by!==undefined&&!["agent","person"].includes(r.stated_by))return null
  if(r.source!==undefined&&(!closed(r.source,["session"])||r.source.session!==undefined&&r.source.session!==context?.session))return null
  if(r.fields!==undefined&&(!closed(r.fields,["what","owner","state"])||r.kind!=="commitment"||r.fields.what!==r.body&&r.body!==undefined||r.fields.owner!==undefined&&r.fields.owner!=="user"||r.fields.state!==undefined&&r.fields.state!=="open"))return null
  const body=r.body??r.fields?.what
  if(typeof body!=="string")return null
  return {record:{kind:r.kind,...(r.kind==="memory"?{type:r.type}:{}),...(r.path!==undefined?{path:r.path}:{}),body}}
}
