// OpenCode's documented permission.reply decisions: once (not always) / reject.
// https://opencode.ai/docs/build/plugins/server#permissions ; runtime 2.2.6 proof is still required.
import { validMemoryBinding } from "./mem-targets.mjs"
import { readFileSync, lstatSync } from "node:fs"
import { resolve, parse, join } from "node:path"
import { intentContext, activeIntentMatches } from "./mem-intents.mjs"
const TARGETS=new Set(["spc-eval-personal","spc-eval-shared"])
export function registerMemoryScopes(policy,authority) {
  if(!validMemoryBinding(policy.memoryBinding)||authority?.schema!=="oc-mem-scopes/1"||authority.fixture!=="mem-synthetic-v1") throw new Error("invalid Memory scope authority")
  const read=(value)=>{
    if(!value||typeof value!=="object"||Array.isArray(value)||Object.entries(value).some(([id,scope])=>!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!TARGETS.has(scope)))throw new Error("invalid reserved Memory scope map")
    return {...value}
  }
  policy.memoryBinding.record_spaces=read(authority.record_spaces)
  policy.memoryBinding.wiki_spaces=read(authority.wiki_spaces??{})
  if (policy.memoryIntent) {
    if (authority.case_id !== policy.memoryIntent.case_id || authority.trial_id !== policy.memoryIntent.trial_id || !Array.isArray(authority.creators)) throw new Error("Memory creator authority belongs to another trial")
    policy.memoryCreators=structuredClone(authority.creators)
  }
}
export function readMemoryAuthority(file) {
  // No ancestor link, bounded regular file. This path is passed by the native runner, not a model/tool argument.
  const full=resolve(file);let at=parse(full).root
  for(const segment of full.slice(at.length).split("/")){at=join(at,segment);if(lstatSync(at).isSymbolicLink())throw new Error("Memory scope authority link refused")}
  const stat=lstatSync(full)
  if(!stat.isFile()||stat.size>65536)throw new Error("Memory scope authority is unsafe")
  return JSON.parse(readFileSync(full,"utf8"))
}
export function refreshMemoryScopes(policy,file) {
  if(!file||!validMemoryBinding(policy.memoryBinding))return
  registerMemoryScopes(policy,readMemoryAuthority(file))
}
export function refreshMemoryTurn(policy,file) {
  if (!file || !policy.memoryIntent) return
  const context=readMemoryAuthority(file)
  if(context.case_id!==policy.memoryIntent.case_id||context.trial_id!==policy.memoryIntent.trial_id)throw new Error("foreign Memory intent turn")
  policy.memoryContext=context
}
const actionFor=(call,action)=>{
  const family=String(call.tool).replace(/^mem[._]/,"")
  if(action===`mem_${family}`)return true
  if(family==="revise")return action===(call.input.action==="forget"?"memory.forget":"memory.revise")
  if(family==="page")return action===(call.input.action==="delete"?"page.delete":"page.write")
  if(family==="wiki")return action===(call.input.action==="delete"?"wiki.delete":"wiki.write")
  return false
}
export function memoryReply(policy,ask,active) {
  if(!validMemoryBinding(policy.memoryBinding))return null
  if(ask.effect==="deny"||policy.mode!=="commit")return "reject"
  if(policy.memoryIntent&&!intentContext(policy,ask.sessionID))return "reject"
  const call=ask.source?.type==="tool"?active.get(`${ask.sessionID}:${ask.source.id}`):null
  if(!call?.pass||!activeIntentMatches(policy,call,ask.sessionID)||!TARGETS.has(call.target)||!actionFor(call,ask.action))return "reject"
  const resources=new Set([call.target,...(call.input.ids??[]),call.input.id,call.input.wiki_id,call.input.path].filter(Boolean))
  if(!Array.isArray(ask.resources)||!ask.resources.length||ask.resources.some((r)=>!resources.has(r)))return "reject"
  return policy.memoryReplies?.[ask.action]==="once"?"once":"reject"
}
