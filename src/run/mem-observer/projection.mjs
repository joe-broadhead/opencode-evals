import { isDeepStrictEqual } from 'node:util'
import { decodeNativeRaw } from './raw-2.2.6.mjs'
import { identityKey, resultText } from './value.mjs'

// Private handoff only. This is intentionally NOT oc-mem-invocations/1.
export function projectEnteredScope({observation,raw}) {
  const issues=[...(raw.issues ?? []),...(observation.health?.issues ?? [])]
  if(observation.schema!=='private-native-entered-scope/1' || observation.version!=='2.2.6' || raw.version!=='2.2.6')issues.push('unsupported-observation-version')
  if(!observation.enteredScopeSealed || observation.state!=='sealed' || observation.pending!==0 || observation.health?.ok!==true || observation.journal?.persistedVerified!==true)issues.push('unsealed-observation')
  // Check that the supplied decoded view still describes the untouched bytes.
  const original=decodeNativeRaw(raw.rawBytes,{version:raw.version})
  if(!original.finishedSessions.includes(observation.scope?.sessionID))issues.push('missing-native-session-finish')
  if(raw.sha256!==original.sha256 || !isDeepStrictEqual(raw.carriers,original.carriers) || !isDeepStrictEqual(raw.issues,original.issues))issues.push('raw-view-mismatch')
  const index=new Map(),directCounts=new Map(),seen=new Set()
  for(const carrier of raw.carriers) {
    const key=identityKey(carrier.native)
    if(index.has(key))issues.push('ambiguous-native-carrier')
    index.set(key,carrier)
    if(carrier.native.sessionID!==observation.scope?.sessionID)issues.push('foreign-raw-session')
  }
  const occurrenceOrder=observation.occurrences.map(occurrence=>{
    let carrier,route='unavailable',text=null
    if(seen.has(occurrence.observerOccurrence))issues.push('duplicate-observer-occurrence')
    seen.add(occurrence.observerOccurrence)
    if(occurrence.native)carrier=index.get(identityKey(occurrence.native))
    if(!isDeepStrictEqual(occurrence.scope,observation.scope))issues.push('foreign-occurrence-scope')
    if(!carrier)issues.push('missing-native-terminal')
    else if(carrier.tool===occurrence.tool) {
      route='direct'
      const key=identityKey(carrier.native)
      directCounts.set(key,(directCounts.get(key)??0)+1)
      if(!occurrence.input?.available || !isDeepStrictEqual(carrier.input,occurrence.input.value))issues.push('direct-input-mismatch')
    } else if(carrier.tool==='execute')route='inner'
    else issues.push('carrier-tool-mismatch')
    if(occurrence.status==='returned' && occurrence.result?.available) {
      try {text=resultText(occurrence.result.value)}catch{issues.push('unsupported-occurrence-output')}
    } else issues.push('unavailable-occurrence-result')
    if(carrier && carrier.status!=='completed')issues.push('native-terminal-error')
    if(route==='direct' && carrier.text!==text)issues.push('direct-output-mismatch')
    return {...structuredClone(occurrence),route,text,partID:carrier?.partID ?? null}
  })
  if([...directCounts.values()].some(count=>count!==1))issues.push('ambiguous-direct-occurrence')
  const inventory=observation.records.find(record=>record.kind==='ready')?.inventory ?? []
  const observedTools=new Set(inventory.map(tool=>tool.id))
  for(const carrier of raw.carriers) {
    if(observedTools.has(carrier.tool) && !directCounts.has(identityKey(carrier.native)))issues.push('missing-observer-occurrence')
  }
  return {
    schema:'private-native-entered-projection/1',coverage:'entered-executor',status:issues.length?'partial':'sealed',
    issues:[...new Set(issues)],rawSha256:raw.sha256,scope:structuredClone(observation.scope),
    observerID:observation.observerID,journal:structuredClone(observation.journal),
    occurrenceOrder,carrierTerminalOrder:structuredClone(raw.carriers),audit:structuredClone(observation.audit),
  }
}
