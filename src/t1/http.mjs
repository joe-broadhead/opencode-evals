import { createServer } from "node:net"

// A tiny HTTP client for the eval host: Basic auth, JSON in and out, a hard timeout. No dependencies,
// because the T1 tier has to run on a machine with nothing but Node and the stock binary.
const auth = () => {
  const password = process.env.EVALS_HOST_PASSWORD ?? "eval"
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

export async function call(url, { method = "GET", body, headers = {}, timeoutMs = 20000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method,
      headers: { authorization: auth(), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    return { status: response.status, ok: response.ok, json, text }
  } finally {
    clearTimeout(timer)
  }
}

export const unwrap = (response) => response.json?.data ?? response.json

/** Waits until `probe` resolves truthy, or throws with what it last saw. */
export async function until(what, probe, { timeoutMs = 45000, everyMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  for (;;) {
    try {
      const value = await probe()
      if (value) return value
      last = value
    } catch (error) {
      last = error?.message ?? String(error)
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what} (last: ${String(last).slice(0, 200)})`)
    await new Promise((resolve) => setTimeout(resolve, everyMs))
  }
}

export const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
