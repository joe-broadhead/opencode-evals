// Do not invoke toJSON/getters, lose undefined, or silently convert non-JSON values.
export function snapshot(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value
  if (!value || typeof value !== 'object' || ancestors.has(value)) throw new Error('unrepresentable-value')
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value)
  if (!array && prototype !== Object.prototype && prototype !== null) throw new Error('unrepresentable-prototype')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string')) throw new Error('unrepresentable-symbol')
  ancestors.add(value)
  try {
    const copy = array ? [] : {}
    const keys = Object.keys(descriptors).filter(k => !(array && k === 'length'))
    if (array && (keys.length !== value.length || keys.some((k,i) => k !== String(i)))) throw new Error('unrepresentable-array')
    for (const key of keys) {
      const d = descriptors[key]
      if (!d.enumerable || !Object.hasOwn(d, 'value')) throw new Error('unrepresentable-property')
      Object.defineProperty(copy,key,{value:snapshot(d.value,ancestors),enumerable:true,writable:false,configurable:false})
    }
    return Object.freeze(copy)
  } finally { ancestors.delete(value) }
}

export function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content) || content.some(p => !p || p.type !== 'text' || typeof p.text !== 'string' || Object.keys(p).some(k => !['type','text'].includes(k)))) throw new Error('unsupported-text-content')
  return content.map(p => p.text).join('\n')
}

export function resultText(result) {
  if (!result || typeof result !== 'object' || Object.hasOwn(result,'output') || result.metadata?.truncated === true) throw new Error('unsupported-result')
  return contentText(result.content)
}

export const nativeIdentity = ({sessionID,messageID,id}) => ({sessionID,messageID,id})
export const nonempty = value => typeof value === 'string' && value.length > 0
export const identityKey = native => JSON.stringify([native.sessionID,native.messageID,native.id])
