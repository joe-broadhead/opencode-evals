import { createHash } from 'node:crypto'
import { contentText, identityKey, nativeIdentity, nonempty } from './value.mjs'

// Private, version-specific projection. The original bytes are never rewritten.
export function decodeNativeRaw(bytes, { version } = {}) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Raw evidence must be a Buffer')
  const rawBytes = Buffer.from(bytes)
  const carriers = [], issues = [], seen = new Set(), parts = new Set(), finishedSessions = new Set()
  const text = rawBytes.toString('utf8')
  if (!Buffer.from(text).equals(rawBytes)) issues.push('invalid-utf8')
  if (rawBytes.length && !text.endsWith('\n')) issues.push('truncated-jsonl')
  if (version !== '2.2.6') issues.push('unsupported-version')
  else for (const [index,line] of text.split('\n').entries()) {
    if (!line.trim()) continue
    let event
    try { event = JSON.parse(line) } catch { issues.push(`invalid-json:${index+1}`); continue }
    if (!event || !['tool_use','text','step_start','step_finish','error','reasoning'].includes(event.type)) { issues.push('unknown-event'); continue }
    if (event.type === 'error') issues.push('native-run-error')
    if (event.type === 'step_finish' && event.part?.reason === 'stop') {
      if(nonempty(event.sessionID) && event.part.sessionID===event.sessionID)finishedSessions.add(event.sessionID)
      else issues.push('invalid-finish-session')
    }
    if (event.type !== 'tool_use') continue
    const part = event.part
    if (!part || Object.hasOwn(part,'callID') || part.type !== 'tool' || !['id','partID','messageID','sessionID','tool'].every(k => nonempty(part[k])) || part.sessionID !== event.sessionID || !part.state) {
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
  return { version, rawBytes, sha256: createHash('sha256').update(rawBytes).digest('hex'), carriers, finishedSessions:[...finishedSessions], issues }
}
