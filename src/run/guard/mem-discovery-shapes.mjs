// Closed public read subset, checked against the static 772bf914 release schemas. Historical 548 input remains archived.
// This classifies a real invocation; input cannot supply authority or a readOnly flag.
const plain=v=>Boolean(v&&typeof v==="object"&&!Array.isArray(v))
const keys=(v,allowed)=>plain(v)&&Object.keys(v).every(k=>allowed.includes(k))
const string=(v,max=200)=>typeof v==="string"&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v)
const optional=(v)=>v===undefined||string(v)
export function discoveryShape(family,input) {
  const bad=()=>({family,write:true,error:"unknown or malformed closed discovery input"})
  const read=(action)=>({family,action,write:false})
  if(family==="read")return keys(input,["id","space"])&&/^rec_[0-9A-HJKMNP-TV-Z]{26}$/.test(input.id)&&optional(input.space)?read("read"):bad()
  if(family==="code") {
    if(!keys(input,["action","graph_id","query","symbol","depth","space"])||!["get","status","files","search","node","callers","callees","impact","explore"].includes(input.action)||typeof input.graph_id!=="string"||!(/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(input.graph_id))||!optional(input.space)||input.depth!==undefined&&(!Number.isInteger(input.depth)||input.depth<1||input.depth>5))return bad()
    if(input.query!==undefined&&!string(input.query)||input.symbol!==undefined&&!string(input.symbol,300))return bad()
    if(input.action==="search"&&!string(input.query)||["node","callers","callees","impact","explore"].includes(input.action)&&!string(input.symbol,300))return bad()
    return read(input.action)
  }
  if(family!=="spaces"||!keys(input,["action","space","cursor","skill","bind","job"])||!optional(input.space)||input.cursor!==undefined&&!string(input.cursor,512))return bad()
  if(input.action==="skills") {
    if(!keys(input,["action","space","cursor","skill"])||!keys(input.skill,["op","id","query","offset"])||!["list","get","search","versions"].includes(input.skill.op))return bad()
    if(input.skill.id!==undefined&&!string(input.skill.id)||input.skill.query!==undefined&&!string(input.skill.query,2048)||input.skill.offset!==undefined&&(!Number.isInteger(input.skill.offset)||input.skill.offset<0||input.skill.offset>100000))return bad()
    if(["get","versions"].includes(input.skill.op)&&!string(input.skill.id)||input.skill.op==="search"&&!string(input.skill.query,2048))return bad()
    return read(`skills.${input.skill.op}`)
  }
  if(input.action==="sources") {
    if(!keys(input,["action","space","bind"]))return bad()
    if(input.bind===undefined)return read("sources.list")
    if(!keys(input.bind,["source","account"])||!string(input.bind.source)||!string(input.bind.account))return bad()
  } else if(input.action==="jobs") {
    if(!keys(input,["action","space","cursor","job"])||!keys(input.job,["op","id","version","limit","template","project","account","every","max_lines"]))return bad()
    const job=input.job
    if(["templates","list","get","versions","runs","logs","diff","items","hosts"].includes(job.op)) {
      if(!keys(job,["op","id","version","limit"])||["get","versions","runs","logs","diff","items"].includes(job.op)&&!string(job.id))return bad()
      if(job.id!==undefined&&!string(job.id)||job.version!==undefined&&(!Number.isInteger(job.version)||job.version<1)||job.limit!==undefined&&(!Number.isInteger(job.limit)||job.limit<1||job.limit>100))return bad()
      return read(`jobs.${job.op}`)
    }
    if(job.op!=="draft"||input.cursor!==undefined||!keys(job,["op","template","project","account","every","max_lines"])||![job.template,job.project,job.account].every(v=>string(v))||job.every!==undefined&&!string(job.every)||job.max_lines!==undefined&&(!Number.isInteger(job.max_lines)||job.max_lines<1||job.max_lines>500))return bad()
  }else return bad()
  if(input.space!==undefined&&!["personal","spc-eval-personal"].includes(input.space))return bad()
  return {family,action:input.action==="sources"?"sources.request":"jobs.draft",write:true,target:"spc-eval-personal"}
}
