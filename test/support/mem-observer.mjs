// Offline adapter for the supported Promise editor/hook seam, not native proof.
import { createHash } from 'node:crypto'
export const schema = {type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}
export const inventory = [{id:'mem_recall',input:schema,options:{codemode:true}}]
export const scope = {case_id:'synthetic',trial:1,trial_id:'trial-one',turn:1,activation_id:'activation-one',incarnation:'incarnation-one',sessionID:'ses_one'}
export const native = {sessionID:'ses_one',messageID:'msg_one',id:'carrier_one',agent:'build'}

export function controls(overrides={}) {
  let lines=''
  const openProof=Object.freeze({}),sealProof=Object.freeze({})
  return {
    openProof,sealProof,
    options:{
      version:'2.2.6',inventory,
      journal:{append(line){lines+=line},read(){return Buffer.from(lines)}},
      async verifyAuthority({action,proof}) {
        if(proof !== (action==='open'?openProof:sealProof))return null
        return {scope,generation:'generation-one',...(action==='seal'?{quiescent:true}:{})}
      },
      async qualifyInventory({inventoryHash}) {return {generation:'generation-one',inventoryHash,promiseTools:['mem_recall'],auditFirst:true,transformsFinal:true,textOnly:true}},
      ...overrides,
    },
    bytes:()=>Buffer.from(lines),
    digest:()=>createHash('sha256').update(lines).digest('hex'),
  }
}

export function domain(execute,id='mem_recall') {
  const original={id,name:id,description:'synthetic recall',input:schema,options:{codemode:true},execute}
  let current={...original}
  const hooks={before:[],after:[]},transforms=[]
  const editor=()=>({list:()=>[current],get:id=>id===current.id?current:undefined,update(id,fn){if(id===current.id)fn(current)}})
  const api={
    async list(){return [{...current}]},
    async transform(fn){transforms.push(fn);fn(editor());return {dispose(){transforms.splice(transforms.indexOf(fn),1);current={...original};for(const f of transforms)f(editor())}}},
    async hook(name,fn){const key=name.split('.')[1];hooks[key].push(fn);return {dispose(){hooks[key].splice(hooks[key].indexOf(fn),1)}}},
  }
  return {
    api, hooks, execute:(input,context=native)=>current.execute(input,context),
    replay(){current={...original};for(const fn of transforms)fn(editor())},
    replace(fields){Object.assign(current,fields)},
    async before(input,context=native){for(const hook of hooks.before)await hook({...context,tool:id,input})},
    async after(input,result,context=native){for(const hook of hooks.after)await hook({...context,tool:id,input,status:'completed',result})},
    async dispatch(input,context=native){
      await this.before(input,context)
      const result=await current.execute(input,context)
      await this.after(input,result,context)
      return result
    },
  }
}
