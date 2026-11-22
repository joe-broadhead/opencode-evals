// Versioned discovery contracts. All truth is synthetic; no captured catalog or runtime success is implied.
import {createHash} from "node:crypto"
import {mkdirSync,writeFileSync} from "node:fs"
import {join,resolve} from "node:path"
import {memCases} from "./cases.mjs"
import {spacesDiscoveryIntent} from "../../src/run/guard/mem-discovery-intents.mjs"
import {isDeepStrictEqual} from "node:util"
export const DISCOVERY_VERSION="mem-discovery/2.1-candidate772"
export const RECORD_ID="rec_01KABCDE1234567890ABCDEFGH"
export const SKILL_ID="skill-quartz"
const clone=v=>structuredClone(v)
// Contract snapshots retain their data types. Reject mutable exotic containers rather than
// silently flattening them (JSON cloning) or pretending Object.freeze seals Map/typed arrays.
export function immutableDiscoveryClone(value){
  const snapshot=clone(value),seen=new WeakSet()
  const freeze=v=>{
    if(!v||typeof v!=="object"||seen.has(v))return v
    if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype)throw new Error("unsupported mutable discovery contract type")
    seen.add(v)
    for(const child of Object.values(v))freeze(child)
    return Object.freeze(v)
  }
  return freeze(snapshot)
}
const empty=()=>({records:[],raw:{},skills:[],codeGraphs:[],wikiGraphs:[],sourceRequests:[],bindings:[],jobs:[],providers:[{source:"gmail",account:"quartz-synthetic",enabled:false,status:"unconfirmed",provider:"synthetic-no-collector"}],templates:[{id:"slack-threads-project",name:"Quartz inactive draft for quartz-synthetic",connector:"slack",grants:[],budgets:{calls:0},every:"inactive until human approval"}]})
const record={id:RECORD_ID,kind:"memory",type:"fact",title:"Quartz fact",body:"Quartz full current body. Record nonce QREC-71.",version:2,status:"current"}
const versions=[{skill_id:SKILL_ID,name:"Quartz",description:"Version marker QS-V1-42",version:1,content:"Skill body QS-V1-42.",is_expired:true},{skill_id:SKILL_ID,name:"Quartz",description:"Version marker QS-V2-93",version:2,content:"Skill body QS-V2-93.",is_expired:false}]
const topology={nodes:[{id:"parseInvoice",name:"parseInvoice"},{id:"submitInvoice",name:"submitInvoice",nonce:"QCODE-37"}],edges:[{source:"submitInvoice",target:"parseInvoice",kind:"calls"}],communities:[]}
const graph={nodes:[{id:"README.md"},{id:"design.md"}],edges:[{source:"README.md",target:"design.md"}],communities:[{id:"quartz-docs",nodes:["README.md","design.md"],nonce:"QWIKI-64"}]}
function contract(old){
  const seed={personal:empty(),shared:empty()};seed.shared.records=[{...record,body:"Shared canary WRONG-SPACE-19."}]
  seed.personal.raw["design.md"]="QUARTZ-92";seed.shared.raw["design.md"]="WRONG-SPACE-19"
  seed.personal.skills=clone(versions);seed.shared.skills=versions.map(v=>({...v,content:"Wrong shared skill",version:v.version+10}))
  seed.personal.codeGraphs=[{id:"code-quartz",name:"Quartz repository",...clone(topology)}]
  seed.shared.codeGraphs=[{id:"code-quartz",nodes:[],edges:[],communities:[]}]
  seed.personal.wikiGraphs=[{id:"wiki-eval-personal",...clone(graph)}];seed.shared.wikiGraphs=[{id:"wiki-eval-shared",nodes:[],edges:[],communities:[]}]
  if(["browse","exact-read"].includes(old.family))seed.personal.records=[clone(record),{...record,id:"rec_01KABCDE1234567890ABCDEFGJ",title:"Quartz other fact",body:"Quartz other fact. QREC-OTHER-28."}]
  if(old.family==="wiki-write")delete seed.personal.raw["design.md"]
  let binding=old.tool?{tool:old.tool,args:clone(old.args)}:null,backend,answer=old.answer
  if(["memory","page","commitment"].includes(old.family))backend={method:"records.put",input:clone(old.input)}
  else if(old.family==="wiki-write")backend={method:"wiki.raw.write",input:{wiki_id:"wiki-eval-personal",files:[{filename:"design.md",content:"Quartz is synthetic."}]}}
  else if(old.family==="wiki-read")backend={method:"wiki.raw.read",input:{wiki_id:"wiki-eval-personal",filenames:["design.md"]}}
  else if(old.family==="browse")backend={method:"records.list",input:{limit:1}}
  else if(old.family==="exact-read"){binding={tool:"read",args:{id:RECORD_ID}};backend={method:"records.get",input:{ids:[RECORD_ID]}};answer=record.body}
  else if(old.family==="code"){binding={tool:"code",args:{action:"callers",graph_id:"code-quartz",symbol:"parseInvoice"}};backend={method:"code-graph.callers",input:{code_graph_id:"code-quartz",symbol:"parseInvoice"}};answer="submitInvoice calls parseInvoice. QCODE-37."}
  else if(old.family==="wiki-graph"){binding={tool:"wiki",args:{action:"graph",wiki_id:"wiki-eval-personal"}};backend={method:"wiki.graph",input:{wiki_id:"wiki-eval-personal"}};answer="README.md links to design.md in quartz-docs. QWIKI-64."}
  else if(old.family==="skills"){binding={tool:"spaces",args:{action:"skills",skill:{op:"versions",id:SKILL_ID}}};backend={method:"skill.versions",input:{skill_id:SKILL_ID,pagination:{limit:50,offset:0}}};answer="Quartz versions: 1 expired; 2 current. QS-V1-42; QS-V2-93."}
  else if(old.family==="sources"){binding={tool:"spaces",args:spacesDiscoveryIntent(old.id)};backend={method:"sources.request",input:{source:"gmail",account:"quartz-synthetic"}};answer="Requested; confirmation is pending. Not linked."}
  else if(old.family==="jobs"){binding={tool:"spaces",args:spacesDiscoveryIntent(old.id)};backend={method:"jobs.draft",input:{template:"slack-threads-project",project:"quartz",account:"quartz-synthetic"}};answer="Draft stored; not active and not running."}
  const prompt=old.family==="exact-read"?(old.id.endsWith("-p")?"Show my Quartz fact in full, not a ranked snippet.":"Read the full current body of my Quartz fact."):old.prompt
  return {id:old.id,original_id:old.id,family:old.family,prompt,prompts:[prompt],suite:DISCOVERY_VERSION,binding,backend,answer,legacy_answer_contract:Boolean(old.answer),seed,write:["memory","page","commitment","wiki-write","sources","jobs"].includes(old.family),source_profile:"772bf914c71e6d0fcb4d7016d2f9b614e2af467d-STATIC-PROVISIONAL"}
}
export const discoveryCases=immutableDiscoveryClone(memCases.map(contract))
export const discoverySuiteHash=createHash("sha256").update(JSON.stringify(discoveryCases)).digest("hex")
export function discoverySnapshot(spec){
  const canonical=discoveryCases.find(s=>s.id===spec?.id)
  if(!canonical||!isDeepStrictEqual(spec,canonical))throw new Error("unknown or changed discovery case; no snapshot")
  return immutableDiscoveryClone(canonical)
}
export function discoveryIntent(spec,trial_id,expires_at){
  const canonical=discoverySnapshot(spec)
  return immutableDiscoveryClone({schema:"oc-mem-intent/1",case_id:canonical.id,trial_id,expires_at,turns:[{index:1,calls:canonical.write?[{family:canonical.binding.tool,args:canonical.binding.args}]:[]}]})
}
export function renderDiscoveryCase(s){return `# ${s.id}
- Plugin: mem
- Skill under test: mem.usage
- Tier: T3
- Set: ${s.id.startsWith("commit-")?"commit":"deep"}, mem-discovery
- Status: active
- Data: synthetic
- Budget: outer_calls <= 14, inner_calls <= 14, tokens <= 64000, wall_ms <= 180000

## Prompt
${s.prompt}

## Items
- [MEM-CT02] blocker · Typed invocation and independent scoped backend truth agree.
  evidence: memory-discovery:${s.id}
${s.legacy_answer_contract?`\n- [MEM-RT01] blocker · The final answer retains the original discovery response contract.\n  evidence: text:any matches /^${s.answer.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}$\/\n`:""}

## Notes
- ${DISCOVERY_VERSION}, suite ${discoverySuiteHash}. Active finite case contract, not runtime approval.
- Candidate 772 schemas are STATIC PROVISIONAL binding inputs, not registered catalog observations.
- Direct/search are separate execution conditions with the same intent. Non-pinned schemas require full-schema discovery after a 117-character preview.
`}
if(process.argv[1]&&resolve(process.argv[1])===import.meta.filename){const dir=resolve(import.meta.dirname,"../../cases/mem");mkdirSync(dir,{recursive:true});for(const s of discoveryCases)writeFileSync(join(dir,`${s.id}.md`),renderDiscoveryCase(s));console.log(`${DISCOVERY_VERSION}: ${discoveryCases.length} executable case contracts; runtime/catalog approval absent; suite ${discoverySuiteHash}`)}
