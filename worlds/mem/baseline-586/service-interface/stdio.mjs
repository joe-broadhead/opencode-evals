import { LIMITS, RpcError, dispatch, limitsError, rpcFailure, validId, validateMessage } from "./mcp.mjs"

export function serveStdio({ sdk, token, input = process.stdin, output = process.stdout, onClose = () => {} }) {
  let buffered = Buffer.alloc(0), discarding = false, closed = false
  const active = new Map(), legacy = {}
  const write = value => {
    if (!value || closed) return
    if (output.writableLength > LIMITS.outputBytes) { close(); return }
    if (!output.write(`${JSON.stringify(value)}\n`)) input.pause()
  }
  output.on("drain", () => { if (!closed) input.resume() })
  function close() {
    if (closed) return
    closed = true
    for (const controller of active.values()) controller.abort()
    active.clear()
    input.pause()
    onClose()
  }
  async function line(bytes) {
    let message
    try {
      try { message = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) } catch { throw new RpcError(-32700, "Parse error") }
      validateMessage(message)
      if (!Object.hasOwn(message, "id")) {
        if (message.method === "notifications/cancelled") {
          const controller = active.get(message.params?.requestId)
          controller?.abort()
          active.delete(message.params?.requestId)
        } else await dispatch(message, { sdk, token, legacy })
        return
      }
      if (active.has(message.id)) {
        active.get(message.id).abort()
        active.delete(message.id)
        throw new RpcError(-32600, "Duplicate in-flight request id")
      }
      if (active.size >= LIMITS.inflight) throw limitsError()
      const controller = new AbortController()
      active.set(message.id, controller)
      const timer = setTimeout(() => {
        controller.abort()
        if (active.get(message.id) === controller) {
          active.delete(message.id)
          write(rpcFailure(message.id, new RpcError(-32603, "Request deadline exceeded", 408)))
        }
      }, LIMITS.deadlineMs)
      try {
        const result = await dispatch(message, { sdk, token, signal: controller.signal, legacy })
        if (!controller.signal.aborted) write(result)
      } finally {
        clearTimeout(timer)
        if (active.get(message.id) === controller) active.delete(message.id)
      }
    } catch (error) {
      // Notifications never receive a response, even when malformed params.
      if (message && !Array.isArray(message) && typeof message.method === "string" && !Object.hasOwn(message, "id")) return
      write(rpcFailure(validId(message?.id) ? message.id : undefined, error))
    }
  }
  input.on("data", chunk => {
    let rest = Buffer.from(chunk)
    while (rest.length) {
      const at = rest.indexOf(10)
      const part = at < 0 ? rest : rest.subarray(0, at)
      if (!discarding && buffered.length + part.length > LIMITS.bytes) {
        buffered = Buffer.alloc(0)
        discarding = true
        write(rpcFailure(undefined, new RpcError(-32600, "Message too large", 413)))
      }
      if (!discarding) buffered = Buffer.concat([buffered, part])
      if (at < 0) break
      if (!discarding && buffered.length) void line(buffered)
      buffered = Buffer.alloc(0)
      discarding = false
      rest = rest.subarray(at + 1)
    }
  })
  input.on("end", close)
  input.on("error", close)
  output.on("error", close)
  return { close }
}
