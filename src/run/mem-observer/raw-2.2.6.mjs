import { createHash } from 'node:crypto'
import { contentText, identityKey, nativeIdentity, nonempty } from './value.mjs'

const partTypes={tool_use:'tool',text:'text',step_start:'step-start',step_finish:'step-finish',reasoning:'reasoning'}

// Private, version-specific projection. The original bytes are never rewritten.
export function decodeNativeRaw(bytes, { version } = {}) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Raw evidence must be a Buffer')
  const rawBytes = Buffer.from(bytes)
  const carriers = [], events = [], sessionIDs = new Set(), issues = [], seen = new Set(), parts = new Set(), finishedSessions = new Set()
  const text = rawBytes.toString('utf8')
  if (!Buffer.from(text).equals(rawBytes)) issues.push('invalid-utf8')
  if (rawBytes.length && !text.endsWith('\n')) issues.push('truncated-jsonl')
  if (version !== '2.2.6') issues.push('unsupported-version')
  else for (const [index,line] of text.split('\n').entries()) {
    if (!line.trim()) continue
    let event
    try { event = JSON.parse(line) } catch { issues.push(`invalid-json:${index+1}`); continue }
    if (!event || !['tool_use','text','step_start','step_finish','error','reasoning'].includes(event.type)) { issues.push('unknown-event'); continue }
    events.push(event)
    if(nonempty(event.sessionID))sessionIDs.add(event.sessionID)
    if(nonempty(event.part?.sessionID))sessionIDs.add(event.part.sessionID)
    if (event.type === 'error') {
      // Run errors have no required part; retain the negative without inventing one.
      issues.push('native-run-error')
      if(!nonempty(event.sessionID) || !event.error || typeof event.error!=='object' || (event.part && event.part.sessionID!==event.sessionID))issues.push('invalid-native-fields')
      continue
    }
    const part = event.part
    // For non-tool parts id IS the part ID; only tool parts have carrier id + partID.
    if(!nonempty(event.sessionID) || !part || part.type!==partTypes[event.type] || !['id','messageID','sessionID'].every(k=>nonempty(part[k])) || part.sessionID!==event.sessionID) {
      issues.push('invalid-native-fields');continue
    }
    if (event.type !== 'tool_use') {
      if((event.type==='text' || event.type==='reasoning') && typeof part.text!=='string')issues.push('invalid-native-content')
      if(event.type==='step_finish') {
        if(!nonempty(part.reason))issues.push('invalid-native-content')
        else if(part.reason==='stop')finishedSessions.add(event.sessionID)
      }
      continue
    }
    if (Object.hasOwn(part,'callID') || !['partID','tool'].every(k => nonempty(part[k])) || !part.state) {
      issues.push('invalid-native-fields'); continue
    }
    const key = identityKey(part)
    if (seen.has(key) || parts.has(part.partID)) issues.push('duplicate-carrier-or-part')
    seen.add(key); parts.add(part.partID)
    const state = part.state
    let output = null, error = null
    if (state.metadata?.metadata?.truncated === true || state.metadata?.truncated === true) issues.push('truncated-output')
    if (state.status === 'completed') {
      try {
        if (typeof state.output !== 'string' || contentText(state.metadata?.content) !== state.output) throw new Error()
        output = state.output
      } catch { issues.push('unsupported-or-mismatched-output') }
    } else if (state.status === 'error' && typeof state.error === 'string') error = state.error
    else issues.push('unsupported-terminal-state')
    if (!Object.hasOwn(state,'input')) issues.push('missing-input')
    carriers.push({
      native: nativeIdentity(part), partID: part.partID, tool: part.tool, input: state.input,
      status: state.status, text: output, error, terminalOrder: carriers.length + 1, line: index + 1,
    })
  }
  return { version, rawBytes, sha256: createHash('sha256').update(rawBytes).digest('hex'), carriers, events, sessionIDs:[...sessionIDs], finishedSessions:[...finishedSessions], issues }
}
