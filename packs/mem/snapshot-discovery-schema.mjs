// Read-only Git object inspection. Existing literal reader, no eval/import of source tool implementations.
import {execFileSync} from "node:child_process"
import {writeFileSync} from "node:fs"
import {createHash} from "node:crypto"
import {readLiteral} from "../../src/trace/innerArgs.mjs"
const pin="5488730012f893f2e456d5bc6540ab3b4708d9c5",repo=process.argv[2]
if(!repo)throw new Error("explicit read-only source repository required")
const paths=["src/tools/spaces.js","src/tools/wiki.js","src/tools/content-read.js","src/tools/content-inventory.js","src/call-shapes.js"]
const sources=Object.fromEntries(paths.map(path=>[path,execFileSync("git",["-C",repo,"show",`${pin}:${path}`],{encoding:"utf8"})]))
const array=(name)=>{const source=Object.values(sources).find(s=>s.includes(`const ${name} =`)),raw=source?.match(new RegExp(`const ${name} = Object.freeze\\((\\[[\\s\\S]*?\\])\\)`))?.[1],v=raw&&readLiteral(raw);if(!v?.ok)throw new Error(`unreadable source enum ${name}`);return v.value}
const enums=Object.fromEntries(["SPACES_ACTIONS","CONSOLE_AREAS","JOB_OPS","DECISIONS","INVENTORY_VIEWS","WIKI_READ_ACTIONS","WIKI_WRITE_ACTIONS","PINNED_TOOLS"].map(n=>[n,array(n)]))
function objectAt(s,start){let depth=0,quote=null;for(let i=start;i<s.length;i++){const c=s[i];if(quote){if(c==="\\")i++;else if(c===quote)quote=null;continue}if(['"',"'","`"].includes(c)){quote=c;continue}if(c==="{")depth++;if(c==="}"&&--depth===0)return s.slice(start,i+1)}throw new Error("unterminated schema object")}
const tools=[...["spaces","wiki"].map(name=>({name,path:`src/tools/${name}.js`})),...["read","code"].map(name=>({name,path:"src/tools/content-read.js"}))].map(({name,path})=>{
  const source=sources[path],at=source.indexOf(`name: "${name}",`),input=source.indexOf("input:",at),start=source.indexOf("{",input),raw=objectAt(source,start)
  let literal=raw;for(const[n,v]of Object.entries(enums))literal=literal.replaceAll(`[...${n}]`,JSON.stringify(v))
  literal=literal.replaceAll("[...WIKI_READ_ACTIONS, ...WIKI_WRITE_ACTIONS]",JSON.stringify([...enums.WIKI_READ_ACTIONS,...enums.WIKI_WRITE_ACTIONS])).replaceAll("${DEFAULT_FILE}","README.md").replaceAll("${REVIEW_LIMIT}","20")
  if(name==="code"){const declared=source.match(/const CODE_READS = Object.freeze\((\{[^\n]+\})\)/)?.[1],values=declared&&readLiteral(declared);if(!values?.ok)throw new Error("unreadable CODE_READS");literal=literal.replace("Object.keys(CODE_READS)",JSON.stringify(Object.keys(values.value)))}
  const parsed=readLiteral(literal),desc=source.slice(source.indexOf("description:",at)+12,input).trim().replace(/,\s*$/,"")
  const description=readLiteral(desc)
  if(!parsed.ok||!description.ok||JSON.stringify(parsed.value).match(/"\$(?:var|ref|spread)"/))throw new Error(`unresolved source schema ${name}`)
  return {name,description:description.value,input:parsed.value,options:{namespace:"mem",pinned:enums.PINNED_TOOLS.includes(name)},source:{pin,path,input_declaration:raw}}
})
const snapshot={schema:"oc-mem-source-schemas/1",source:{commit:pin,kind:"PROVISIONAL-source-schema-fixture-not-runtime",final_release:false,registered_observation:false,files:Object.fromEntries(paths.map(p=>[p,createHash("sha256").update(sources[p]).digest("hex")]))},tools}
writeFileSync(new URL("./discovery-schemas.json",import.meta.url),JSON.stringify(snapshot,null,2)+"\n")
console.log(`${tools.length} complete closed public input schemas snapshotted without executing source tools`)
