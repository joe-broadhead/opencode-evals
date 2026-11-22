import {createNativeAuthority} from "../../src/run/guard/mem-native-authority.mjs"
import {coreMemoryIntent} from "../../src/run/mem-intent-plan.mjs"
import {nativeOperationPlan} from "../../src/run/mem-operation-plan.mjs"
export const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
export function assertionFixture() {
  const intent=coreMemoryIntent({original_id:"core-durability",prompts:["store","read"]},"trial_assert",Date.now()+60000)
  const state={activation:{schema:"oc-mem-native-activation/1",case_id:intent.case_id,trial_id:intent.trial_id,trial:1,turn:1,session:"ses_assert",activation_id:"activation_1",incarnation:1,generation:"generation_1",active:true}}
  const policy={mode:"commit",memoryIntent:intent,memoryOperationPlan:nativeOperationPlan(intent),memoryBinding:{schema:"oc-mem-contained/1",fixture:"mem-synthetic-v1",backend:"container",origin:"http://127.0.0.1:4617"},writes:[{names:["mem_remember"],memory:"remember",allow:["spc-eval-personal"]}],memoryReplies:{mem_remember:"once",mem_recall:"once"}}
  const authority=createNativeAuthority(policy,{readActivation:()=>{state.onActivation?.();return structuredClone(state.activation)},readScopes:()=>{state.onScopes?.();return {schema:"oc-mem-scopes/1",fixture:"mem-synthetic-v1",case_id:intent.case_id,trial_id:intent.trial_id,record_spaces:{},wiki_spaces:{},creators:[]}},readCompletion:()=>state.completionReader?.()??null})
  const request={tool:"mem_remember",input:intent.turns[0].calls[0].args,native:{sessionID:"ses_assert",messageID:"message_1",id:"carrier_1"}}
  const snapshot={sessionID:"ses_assert",agent:"agent_test",action:"mem_remember",resources:["spc-eval-personal"],save:[],source:{type:"tool",id:"carrier_1",messageID:"message_1"},metadata:{purpose:"synthetic"}}
  const proof=authority.open()
  return {authority,request,snapshot,state,proof}
}
