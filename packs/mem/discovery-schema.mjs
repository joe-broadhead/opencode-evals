// Source-derived parameterization only. Actual registered metadata remains a separate runtime gate.
import {readFileSync} from "node:fs"
import {createHash} from "node:crypto"
import {discoveryShape} from "../../src/run/guard/mem-discovery-shapes.mjs"
const base=JSON.parse(readFileSync(new URL("./catalog.json",import.meta.url))),source=JSON.parse(readFileSync(new URL("./discovery-schemas.json",import.meta.url)))
export const sourceDiscoveryCatalog={source:source.source,tools:[...base.tools.filter(t=>!source.tools.some(x=>x.name===t.name)),...source.tools]}
export function sourceInputFailures(schema,value,path="input"){
  const out=[],bad=why=>out.push(`${path}: ${why}`)
  if(schema.type==="object"){
    if(!value||typeof value!=="object"||Array.isArray(value))return [`${path}: object required`]
    for(const key of schema.required??[])if(!Object.hasOwn(value,key))bad(`${key} required`)
    for(const[k,v]of Object.entries(value)){if(schema.properties?.[k])out.push(...sourceInputFailures(schema.properties[k],v,`${path}.${k}`));else if(schema.additionalProperties===false)bad(`${k} unknown`)}
  }else if(schema.type==="array"){
    if(!Array.isArray(value))bad("array required");else{if(schema.maxItems!==undefined&&value.length>schema.maxItems)bad("too many items");if(schema.items)for(const v of value)out.push(...sourceInputFailures(schema.items,v,path))}
  }else if(schema.type==="integer"?!Number.isInteger(value):schema.type&&typeof value!==schema.type)bad(`${schema.type} required`)
  if(schema.enum&&!schema.enum.includes(value))bad("enum mismatch")
  if(typeof value==="number"&&(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum))bad("out of bounds")
  if(typeof value==="string"&&(schema.maxLength!==undefined&&value.length>schema.maxLength||schema.pattern&&!new RegExp(schema.pattern).test(value)))bad("string shape mismatch")
  return out
}
export function discoveryCondition(spec,{mode,catalog}){
  if(!["direct","search"].includes(mode)||!catalog?.source||!Array.isArray(catalog.tools))throw new Error("closed source schema condition required")
  const tool=catalog.tools.find(t=>t.name===spec.binding?.tool)
  if(tool?.input?.type!=="object"||tool.input.additionalProperties!==false||sourceInputFailures(tool.input,spec.binding.args).length)throw new Error("discovery binding does not match closed source schema")
  if(["spaces","read","code"].includes(tool.name)&&discoveryShape(tool.name,spec.binding.args).error)throw new Error("input exceeds closed discovery subset")
  return {mode,tool:tool.name,args:structuredClone(spec.binding.args),description:tool.description,head117:tool.description.slice(0,117),full_schema:structuredClone(tool.input),schema_sha256:createHash("sha256").update(JSON.stringify(tool.input)).digest("hex"),requires_full_schema_lookup:tool.options?.pinned!==true,source_status:"PROVISIONAL",runtime_observed:false,condition_parameter_only:true}
}
