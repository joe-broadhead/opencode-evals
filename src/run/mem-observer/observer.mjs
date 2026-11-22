import { createHash, randomUUID } from 'node:crypto'
import { snapshot, nativeIdentity, identityKey, nonempty, resultText } from './value.mjs'

const digest = text => createHash('sha256').update(text).digest('hex')
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b)
const scopeValid = s => s && ['case_id','trial_id','activation_id','sessionID'].every(k=>nonempty(s[k])) && (nonempty(s.incarnation) || (Number.isSafeInteger(s.incarnation) && s.incarnation>0)) && Number.isSafeInteger(s.trial) && s.trial>0 && Number.isSafeInteger(s.turn) && s.turn>0
const descriptor = t => ({id:t.id,input:t.input,options:t.options ?? {}})

/** Passive observer only. No permission request, reply, grant, or tool admission. */
export function createNativeObserver({version,inventory,journal,verifyAuthority,qualifyInventory,readReservation}={}) {
  const observerID=randomUUID(),issues=new Set(),records=[],occurrences=[],audit=[],registrations=[]
  let state='new',toolDomain,expected,scope=null,generation=null,revision=0,pending=0,log='',persistedVerified=false,busy=false
  let closing=false,closePromise
  const invalidate = reason => {issues.add(reason);state=closing?'closed':'invalid';persistedVerified=false}
  const capture = value => {
    try {return {available:true,value:snapshot(value)}}
    catch {invalidate('snapshot-unavailable');return {available:false}}
  }
  try {expected=snapshot(inventory)} catch {expected=[];invalidate('inventory-unavailable')}
  const ids=new Set((Array.isArray(expected)?expected:[]).map(t=>t.id))
  const record = (kind,body={}) => {
    // All payloads are owned snapshots; sink failure cannot change executor outcomes.
    try {
      const entry=snapshot({sequence:records.length+1,observerID,kind,...body})
      records.push(entry)
      const line=JSON.stringify(entry)+'\n';log+=line
      const returned=journal?.append(line)
      if (!journal || typeof journal.append!=='function' || returned!==undefined) {
        returned?.catch?.(()=>{})
        invalidate('journal-append-unavailable')
      }
    } catch {invalidate('journal-append-failed')}
  }
  const status = () => structuredClone({
    schema:'private-native-entered-scope/1',coverage:'entered-executor',version,observerID,
    state,generation,revision,scope,pending,enteredScopeSealed:state==='sealed' && issues.size===0 && persistedVerified,
    health:{ok:issues.size===0,issues:[...issues]},occurrences,audit,records,
    journal:{count:records.length,sha256:digest(log),persistedVerified},
  })
  const observedScope = context => {
    if (state!=='open') invalidate('entry-outside-open-scope')
    if (!scope || context.sessionID!==scope.sessionID) invalidate('foreign-scope')
    if (!['sessionID','messageID','id'].every(k=>nonempty(context[k]))) invalidate('native-identity-unavailable')
    return scope
  }
  const observeAudit = (phase,event) => {
    if(closing)return
    if (!ids.has(event.tool) && event.tool!=='execute') return
    try {
      observedScope(event)
      const fact={phase,tool:event.tool,native:capture(nativeIdentity(event)),input:capture(event.input)}
      if (phase==='after') {
        fact.status=event.status
        if(event.status==='completed')fact.result=capture(event.result)
        else {fact.error=capture({message:typeof event.error?.message==='string'?event.error.message:'unavailable'});invalidate('observed-native-error')}
      }
      audit.push(snapshot(fact));record('audit',fact)
    } catch {invalidate('audit-unavailable')}
  }
  const wrap = (id,original) => async (input,context) => {
    // Allocated inside each evaluated invocation, never at transform registration.
    const occurrence={observerOccurrence:`${observerID}:${occurrences.length+1}`,order:occurrences.length+1,tool:id,status:'pending'}
    pending++;occurrences.push(occurrence)
    let abort
    try {
      try {
        occurrence.scope=capture(observedScope(context)).value ?? null
        occurrence.native=capture(nativeIdentity(context)).value ?? null
        occurrence.input=capture(input)
        if(readReservation) {
          const evidence=readReservation({scope:occurrence.scope,native:occurrence.native,tool:id})
          if(evidence && typeof evidence.then==='function') {
            // Unsupported asynchronous evidence is discarded, but its rejection is owned.
            Promise.resolve(evidence).catch(()=>{})
            occurrence.reservation={available:false}
          } else occurrence.reservation=capture(evidence)
          const supplied=occurrence.reservation.value
          if(!supplied || !nonempty(supplied.grant_id) || !nonempty(supplied.reservation_id) || Object.keys(supplied).some(k=>!['grant_id','reservation_id'].includes(k)))invalidate('reservation-evidence-unavailable')
        }
        abort=()=>{invalidate('cancelled');record('cancel',{observerOccurrence:occurrence.observerOccurrence})}
        if(context.signal?.aborted)abort()
        else context.signal?.addEventListener('abort',abort,{once:true})
        record('entered',occurrence)
      } catch {invalidate('entry-observation-unavailable')}
      try {
        const result=await original(input,context)
        occurrence.status='returned'
        occurrence.result=capture(result)
        try {occurrence.text=resultText(occurrence.result.value)} catch {invalidate('unsupported-output');occurrence.text=null}
        record('returned',{observerOccurrence:occurrence.observerOccurrence,result:occurrence.result,text:occurrence.text})
        return result
      } catch(error) {
        occurrence.status='rejected'
        // Read diagnostics defensively; never substitute a logging failure for error.
        try {occurrence.error=capture({message:typeof error?.message==='string'?error.message:'unavailable',aborted:context.signal?.aborted===true})} catch {invalidate('error-observation-unavailable')}
        invalidate('observed-executor-rejection')
        record('rejected',{observerOccurrence:occurrence.observerOccurrence,error:occurrence.error ?? {available:false}})
        throw error
      }
    } finally {
      pending--
      try {if(abort)context.signal?.removeEventListener('abort',abort)} catch {invalidate('abort-cleanup-unavailable')}
      record('settled',{observerOccurrence:occurrence.observerOccurrence,pending})
    }
  }
  const inspect = async () => {
    const listed=await toolDomain.list()
    const selected=listed.filter(t=>ids.has(t.id))
    if (selected.length!==ids.size || ids.size!==expected.length || !ids.size) throw new Error('inventory-mismatch')
    if(selected.some(t=>t.output!==undefined || typeof t.execute!=='function'))throw new Error('unsupported-executor-or-output-schema')
    const actual=snapshot(selected.map(descriptor).sort((a,b)=>a.id.localeCompare(b.id)))
    const wanted=[...expected].sort((a,b)=>a.id.localeCompare(b.id))
    if(!same(actual,wanted))throw new Error('inventory-mismatch')
    return {inventory:actual,inventoryHash:digest(JSON.stringify(actual)),revision}
  }
  const auditBalanced = () => {
    const groups=new Map()
    const group=(tool,native)=>{
      const key=JSON.stringify([tool,identityKey(native)])
      if(!groups.has(key))groups.set(key,{tool,before:[],after:[],entered:[]})
      return groups.get(key)
    }
    for(const fact of audit) {
      if(!fact.native.available || !fact.input.available)return false
      group(fact.tool,fact.native.value)[fact.phase].push(fact)
    }
    for(const occurrence of occurrences)group(occurrence.tool,occurrence.native).entered.push(occurrence)
    const bag=values=>values.map(v=>JSON.stringify(v)).sort()
    const result=value=>({...value,content:resultText(value)})
    for(const {tool,before,after,entered} of groups.values()) {
      if(before.length!==after.length || after.some(f=>f.status!=='completed' || !f.result.available))return false
      if(tool==='execute')continue
      if(before.length!==entered.length || entered.some(o=>o.status!=='returned' || !o.input.available || !o.result.available))return false
      // These multisets veto scope coverage only. They NEVER identify a call.
      if(!same(bag(before.map(f=>f.input.value)),bag(entered.map(o=>o.input.value))))return false
      if(!same(bag(after.map(f=>f.input.value)),bag(entered.map(o=>o.input.value))))return false
      if(!same(bag(after.map(f=>result(f.result.value))),bag(entered.map(o=>result(o.result.value)))))return false
    }
    return true
  }
  const control = action => async (...args) => {
    if(closing)return status()
    if(busy){invalidate('overlapping-control');return status()}
    busy=true
    try {await action(...args)} catch(error){invalidate(typeof error?.message==='string'?error.message:'control-unavailable')}
    finally {busy=false}
    return status()
  }
  const dispose = async registration => {
    try {await registration?.dispose?.()}catch{invalidate('registration-disposal-failed')}
  }
  const register = async acquire => {
    if(closing)return false
    const registration=await acquire()
    if(closing){await dispose(registration);return false}
    registrations.push(registration)
    return true
  }
  return {
    status,
    install:control(async api=>{
      if(state!=='new' || version!=='2.2.6')throw new Error('unsupported-installation')
      toolDomain=api
      if(!await register(()=>api.hook('execute.before',event=>observeAudit('before',event))))return
      if(!await register(()=>api.hook('execute.after',event=>observeAudit('after',event))))return
      if(!await register(()=>api.transform(editor=>{
        if(closing)return
        revision++
        if(revision!==1)invalidate('registry-replayed')
        for(const id of ids)editor.update(id,tool=>{const original=tool.execute;tool.execute=wrap(id,original)})
      })))return
      if(!closing && !issues.size)state='installed'
    }),
    ready:control(async()=>{
      if(state!=='installed')throw new Error('not-installed')
      if(typeof verifyAuthority!=='function' || typeof qualifyInventory!=='function')throw new Error('integration-capability-unavailable')
      const observed=await inspect()
      if(closing)return
      const qualified=await qualifyInventory(structuredClone(observed))
      if(!qualified || qualified.inventoryHash!==observed.inventoryHash || !nonempty(qualified.generation) || qualified.auditFirst!==true || qualified.transformsFinal!==true || qualified.textOnly!==true || !Array.isArray(qualified.promiseTools) || !same([...qualified.promiseTools].sort(),[...ids].sort()))throw new Error('inventory-qualification-unavailable')
      if(revision!==observed.revision || issues.size)throw new Error('inventory-generation-changed')
      const final=await inspect()
      if(closing || issues.size || final.inventoryHash!==observed.inventoryHash || final.revision!==observed.revision)throw new Error('inventory-generation-changed')
      generation=qualified.generation;state='ready';record('ready',{generation,...observed})
    }),
    open:control(async proof=>{
      if(state!=='ready')throw new Error('not-ready')
      const observed=await inspect()
      if(closing)return
      const verified=await verifyAuthority({action:'open',proof,generation})
      if(!verified || verified.generation!==generation || !scopeValid(verified.scope))throw new Error('authority-unavailable')
      if(state!=='ready' || revision!==observed.revision || issues.size)throw new Error('open-raced-with-activity')
      scope=snapshot(verified.scope);state='open';record('open',{scope,generation})
    }),
    seal:control(async proof=>{
      if(state!=='open')throw new Error('scope-not-open')
      state='sealing'
      const verified=await verifyAuthority({action:'seal',proof,scope:structuredClone(scope),generation})
      if(closing)return
      if(!verified || !same(verified.scope,scope) || verified.generation!==generation || verified.quiescent!==true)throw new Error('quiescence-authority-unavailable')
      await inspect()
      if(pending || state!=='sealing' || issues.size)throw new Error('scope-not-quiescent')
      if(!auditBalanced())throw new Error('native-coverage-mismatch')
      state='sealed';record('seal',{scope,generation})
      const persisted=journal.read()
      if(!Buffer.isBuffer(persisted)) {
        persisted?.catch?.(()=>{})
        throw new Error('persisted-journal-unavailable')
      }
      if(!persisted.equals(Buffer.from(log)))throw new Error('persisted-journal-mismatch')
      persistedVerified=true
    }),
    invalidate(reason='caller-revoked'){invalidate(reason);record('revoked',{reason});return status()},
    close(){
      if(closePromise)return closePromise
      closing=true
      invalidate('lifecycle-closed')
      // Do not wait for an uncooperative control capability. register() owns late arrivals.
      closePromise=(async()=>{
        for(const registration of registrations.splice(0).reverse())await dispose(registration)
        record('closed',{pending})
        return status()
      })()
      return closePromise
    },
  }
}
