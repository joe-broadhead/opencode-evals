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
// The real stringList: a bare string or a list of at most `max` (records/src/store.js:1483-1494).
const stringList=(v,max=20)=>text(v)||Array.isArray(v)&&v.length>0&&v.length<=max&&v.every(x=>text(x,300))
export function validDiscoveryReadInput(method,v){
  if(!plain(v))return false
  // records.get `{ids?, paths?}` (records/src/store.js:4104-4113): two lists of
  // strings, at least one id or path together, at most 50 together. Any string
  // is taken — an unknown id or path comes back in `missing` (store.js:4118-4128)
  // — so the rec_ form is a resolution outcome, not a validation rule.
  if(method==="records.get"){const count=(v.ids?.length??0)+(v.paths?.length??0);return closed(v,["ids","paths"])&&optional(v.ids,strings)&&optional(v.paths,strings)&&count>=1&&count<=50}
  // records.list (records/src/store.js:4132-4185): kind and type a string or a
  // list of at most 20 (stringList, store.js:1483-1494 with KINDS/type
  // membership checked by the store's own query, not refused here); status
  // "all" (every status, store.js:1521), "current" (the default view,
  // store.js:1522) or a list of the record statuses (stringList against
  // STATUSES, store.js:1523); limit a whole number from 1 to 200
  // (intInRange, store.js:4140); the cursor the service's own (store.js:4141);
  // the path prefix's wire key path_prefix (checkPrefix, store.js:4139,
  // 1496-1503); and full === true keeps whole bodies while its absence cuts
  // them (listed, store.js:1436-1443) — the real service tests `full === true`
  // only, so anything but a boolean is out of contract here. `prefix` stays
  // accepted as the fixture's own subset key it already was. The selection
  // filters (SELECTION_FILTERS, store.js:1532) are deliberately not opened: no
  // plugin wire and no graded case carries them, and the finite store keeps
  // none of their data (no created/updated stamps, no agents or tasks), so
  // accepting them would answer a filter the store cannot honor.
  if(method==="records.list")return closed(v,["kind","type","status","limit","cursor","prefix","path_prefix","full"])&&optional(v.kind,x=>stringList(x))&&optional(v.type,x=>stringList(x))&&optional(v.status,x=>x==="all"||x==="current"||Array.isArray(x)&&x.length>0&&x.every(s=>STATUSES.includes(s)))&&optional(v.limit,x=>integer(x,1,200))&&optional(v.cursor,text)&&optional(v.prefix,text)&&optional(v.path_prefix,text)&&optional(v.full,x=>x===true||x===false)
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
