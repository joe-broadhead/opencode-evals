// The batch's egress proxy: the one way out of a trial's network. CONNECT only, to port 443 only, of a host name on
// the allow-list only (exact, case-insensitive; no wildcard, no IP literal), only when the name resolves to a public
// address, and only for a TLS session whose ClientHello names that same host. Everything else is answered 403 (405 for
// a method other than CONNECT, 429 past the tunnel caps) or closed, and logged.
//
// It never sees a request body or a header beyond the CONNECT line (the tunnel is TLS end to end) and logs host
// names only, one JSON line per decision on stdout: {"ev":"allowed"|"refused"|"failed","host":"…","why":"…"}.
//
//   EVALS_EGRESS_ALLOW=api.anthropic.com,platform.claude.com node egress-proxy.mjs [port]
//
// Plain Node, no dependency: it runs on Ubuntu 24.04's node (18) inside the sandbox image, and in the tests on the host.

import { createServer, connect } from "node:net"
import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"
import { pathToFileURL } from "node:url"

const HEAD_LIMIT = 16 * 1024
const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/

/** A host name as logged: lower case, only the characters a name or an address can have, at most 253. */
export const clean = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9.:[\]-]/g, "?").slice(0, 253)

/** An IPv6 address as eight 16-bit groups (an embedded dotted IPv4 tail included), or null. */
export function groups6(address) {
  let text = String(address).toLowerCase().replace(/%.*$/, "")
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (v4) {
    if (isIP(v4[1]) !== 4) return null
    const [a, b, c, d] = v4[1].split(".").map(Number)
    text = `${text.slice(0, -v4[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = text.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const all = [...head, ...Array(Math.max(fill, 0)).fill("0"), ...tail]
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return all.map((g) => parseInt(g, 16))
}

/**
 * Is an address one a trial must never reach through the proxy: private, loopback, link-local, CGNAT, multicast,
 * documentation, or an IPv6 form that carries or tunnels an IPv4 address (IPv4-mapped, IPv4-compatible, NAT64 64:ff9b::/96
 * and 64:ff9b:1::/48, 6to4 2002::/16, Teredo 2001::/32), whatever the IPv4 inside it?
 */
export function privateAddress(address) {
  const kind = isIP(address)
  if (kind === 4) {
    const [a, b, c] = address.split(".").map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)
  }
  if (kind !== 6) return true
  const g = groups6(address)
  if (!g) return true
  const zero = (n) => g.slice(0, n).every((x) => x === 0)
  if (zero(5) && g[5] === 0xffff) return true // IPv4-mapped, whatever the IPv4 inside
  if (zero(6)) return true // ::, ::1 and IPv4-compatible ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return true // NAT64, well-known and local-use
  if (g[0] === 0x2002) return true // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true // documentation
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true // discard-only 100::/64
  if ((g[0] & 0xfe00) === 0xfc00) return true // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true // multicast
  return false
}

/** Parses an allow-list: host names only, exact. Throws on a wildcard, an address or anything else. */
export function parseAllow(text) {
  const hosts = String(text ?? "").split(/[\s,]+/).map((h) => h.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean)
  for (const host of hosts) if (!HOST.test(host) || isIP(host)) throw new Error(`egress allow-list: ${JSON.stringify(host)} is not a host name`)
  return new Set(hosts)
}

const HELLO_LIMIT = 64 * 1024

/** The server name of a TLS ClientHello's SNI extension: { sni } (null when it has none), { incomplete }, or { error }. */
function helloName(body) {
  let p = 0
  const need = (n) => {
    if (p + n > body.length) throw new Error("short")
  }
  try {
    need(34)
    p += 34 // client_version, random
    need(1)
    p += 1 + body[p] // session id
    need(2)
    p += 2 + body.readUInt16BE(p) // cipher suites
    need(1)
    p += 1 + body[p] // compression methods
    if (p === body.length) return { sni: null }
    need(2)
    const end = p + 2 + body.readUInt16BE(p)
    p += 2
    if (end > body.length) return { error: "malformed" }
    while (p + 4 <= end) {
      const type = body.readUInt16BE(p)
      const length = body.readUInt16BE(p + 2)
      p += 4
      if (p + length > end) return { error: "malformed" }
      if (type === 0) {
        if (length < 2) return { error: "malformed" }
        const listEnd = p + 2 + body.readUInt16BE(p)
        if (listEnd > p + length) return { error: "malformed" }
        let q = p + 2
        while (q + 3 <= listEnd) {
          const nameType = body[q]
          const nameLength = body.readUInt16BE(q + 1)
          q += 3
          if (q + nameLength > listEnd) return { error: "malformed" }
          if (nameType === 0) return { sni: body.subarray(q, q + nameLength).toString("latin1").toLowerCase().replace(/\.$/, "") }
          q += nameLength
        }
        return { sni: null }
      }
      p += length
    }
    return { sni: null }
  } catch {
    return { error: "malformed" }
  }
}

/** Reads the first TLS handshake message from the bytes a client sent, across records, and names its SNI. */
export function clientHelloSni(buffer) {
  const parts = []
  let pos = 0
  if (buffer.length && buffer[0] !== 22) return { error: "not-tls" }
  while (pos + 5 <= buffer.length) {
    if (buffer[pos] !== 22) return { error: "not-tls" }
    const length = buffer.readUInt16BE(pos + 3)
    if (length === 0 || length > 18432) return { error: "malformed" }
    if (pos + 5 + length > buffer.length) break
    parts.push(buffer.subarray(pos + 5, pos + 5 + length))
    pos += 5 + length
    const handshake = Buffer.concat(parts)
    if (handshake.length >= 4) {
      if (handshake[0] !== 1) return { error: "not-client-hello" }
      const total = handshake.readUIntBE(1, 3) + 4
      if (total > HELLO_LIMIT) return { error: "malformed" }
      if (handshake.length >= total) return helloName(handshake.subarray(4, total))
    }
  }
  return buffer.length > HELLO_LIMIT + 1024 ? { error: "malformed" } : { incomplete: true }
}

/**
 * The proxy. `lookup(host)` resolves a name to [{ address, family }] (DNS by default); `log(entry)` receives each
 * decision; `dial(address, port)` opens the upstream socket (a test can point it at a local server).
 *
 * After `200 Connection Established` nothing goes through the tunnel until the client's first TLS message, its
 * ClientHello, names the very host it asked to CONNECT to (SNI, compared exactly): a tunnel to an allowed name cannot
 * carry a TLS session to another one behind the same address. No SNI, anything that is not a ClientHello, or nothing
 * within `helloTimeoutMs`, and the tunnel is closed. At most `maxPerClient` connections per client address (one trial
 * is one address) and `maxTotal` in all are open at once; another is answered 429.
 */
export function createProxy({ allow, lookup = (host) => dnsLookup(host, { all: true, verbatim: true }), log = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`), dial = (address, port) => connect({ host: address, port }), helloTimeoutMs = 10_000, maxPerClient = 16, maxTotal = 64 } = {}) {
  const allowed = allow instanceof Set ? allow : parseAllow(allow)
  const active = new Map()
  let total = 0
  return createServer((client) => {
    const from = client.remoteAddress ?? ""
    client.on("error", () => {})
    if ((active.get(from) ?? 0) >= maxPerClient || total >= maxTotal) {
      log({ ev: "refused", host: "", why: "too-many-tunnels" })
      client.end("HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
      return
    }
    active.set(from, (active.get(from) ?? 0) + 1)
    total++
    client.on("close", () => {
      total--
      const left = (active.get(from) ?? 1) - 1
      if (left > 0) active.set(from, left)
      else active.delete(from)
    })
    let head = Buffer.alloc(0)
    let decided = false
    client.setTimeout(10_000)
    client.on("timeout", () => client.destroy())
    const refuse = (status, host, why) => {
      decided = true
      log({ ev: "refused", host: clean(host), why })
      client.end(`HTTP/1.1 ${status} ${status === 405 ? "Method Not Allowed" : "Forbidden"}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`)
    }
    const onData = async (chunk) => {
      if (decided) return
      head = Buffer.concat([head, chunk])
      const end = head.indexOf("\r\n\r\n")
      if (end < 0) {
        if (head.length > HEAD_LIMIT) refuse(403, "", "head-too-large")
        return
      }
      client.off("data", onData)
      client.pause()
      decided = true
      const rest = head.subarray(end + 4)
      const line = head.subarray(0, head.indexOf("\r\n")).toString("latin1")
      const [method, target] = line.split(" ")
      if (method !== "CONNECT") {
        let host = ""
        try {
          host = new URL(target).hostname
        } catch {
          host = (/^host:\s*([^\s:]+)/im.exec(head.toString("latin1")) ?? [])[1] ?? ""
        }
        return refuse(405, host, "not-connect")
      }
      const match = /^\[?([^\]]*?)\]?:(\d{1,5})$/.exec(target ?? "")
      if (!match) return refuse(403, target, "bad-target")
      const host = match[1].toLowerCase().replace(/\.$/, "")
      const port = Number(match[2])
      if (isIP(host)) return refuse(403, host, "address")
      if (!HOST.test(host)) return refuse(403, host, "bad-host")
      if (port !== 443) return refuse(403, host, "port")
      if (!allowed.has(host)) return refuse(403, host, "not-allowed")
      let addresses
      try {
        addresses = (await lookup(host)).map((entry) => entry.address)
      } catch {
        log({ ev: "failed", host, why: "dns" })
        return client.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
      }
      const usable = addresses.filter((address) => !privateAddress(address))
      if (!usable.length) return refuse(403, host, "private-address")
      const upstream = dial(usable[0], port)
      upstream.setTimeout(10_000)
      upstream.on("timeout", () => upstream.destroy())
      let open = false
      upstream.on("error", () => {
        if (open) return client.destroy()
        log({ ev: "failed", host, why: "connect" })
        client.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
      })
      client.on("close", () => upstream.destroy())
      upstream.on("close", () => client.destroy())
      upstream.on("connect", () => {
        open = true
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        let hello = rest
        let settled = false
        const stopReading = () => {
          settled = true
          clearTimeout(timer)
          client.off("data", onHello)
        }
        const reject = (why) => {
          stopReading()
          log({ ev: "refused", host, why })
          client.destroy()
          upstream.destroy()
        }
        const check = () => {
          if (settled) return
          const read = clientHelloSni(hello)
          if (read.incomplete) return
          if (read.error) return reject("bad-client-hello")
          if (!read.sni) return reject("no-sni")
          if (read.sni !== host) return reject("sni-mismatch")
          stopReading()
          log({ ev: "allowed", host })
          // A long model stream is quiet for a while; a tunnel idle for fifteen minutes is closed.
          upstream.setTimeout(15 * 60_000)
          client.setTimeout(15 * 60_000)
          upstream.write(hello)
          client.pipe(upstream)
          upstream.pipe(client)
        }
        const onHello = (chunk) => {
          hello = Buffer.concat([hello, chunk])
          check()
        }
        const timer = setTimeout(() => reject("no-client-hello"), helloTimeoutMs)
        // A client that closes before saying anything has not been refused anything.
        client.once("close", stopReading)
        client.on("data", onHello)
        client.resume()
        check()
      })
    }
    client.on("data", onData)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? 3128)
  const server = createProxy({ allow: process.env.EVALS_EGRESS_ALLOW, maxPerClient: Number(process.env.EVALS_EGRESS_MAX_PER_CLIENT) || 16, maxTotal: Number(process.env.EVALS_EGRESS_MAX_TOTAL) || 64 })
  server.listen(port, "0.0.0.0", () => process.stdout.write(`${JSON.stringify({ ev: "listening", port })}\n`))
  process.on("SIGTERM", () => process.exit(0))
}
