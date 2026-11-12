// The batch's egress proxy: the one way out of a trial's network. CONNECT only, to port 443 only, of a host name on
// the allow-list only (exact, case-insensitive; no wildcard, no IP literal), and only when the name resolves to a
// public address. Everything else is answered 403 (405 for a method other than CONNECT) and logged.
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

/** Is an address one a trial must never reach through the proxy: private, loopback, link-local, CGNAT, multicast…? */
export function privateAddress(address) {
  const kind = isIP(address)
  if (kind === 4) {
    const [a, b] = address.split(".").map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
  }
  if (kind === 6) {
    const text = address.toLowerCase()
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text)
    if (mapped) return privateAddress(mapped[1])
    return text === "::" || text === "::1" || /^f[cd]/.test(text) || /^fe[89ab]/.test(text) || /^ff/.test(text) || text.startsWith("64:ff9b:") || text.startsWith("::ffff:")
  }
  return true
}

/** Parses an allow-list: host names only, exact. Throws on a wildcard, an address or anything else. */
export function parseAllow(text) {
  const hosts = String(text ?? "").split(/[\s,]+/).map((h) => h.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean)
  for (const host of hosts) if (!HOST.test(host) || isIP(host)) throw new Error(`egress allow-list: ${JSON.stringify(host)} is not a host name`)
  return new Set(hosts)
}

/**
 * The proxy. `lookup(host)` resolves a name to [{ address, family }] (DNS by default); `log(entry)` receives each
 * decision; `dial(address, port)` opens the upstream socket (a test can point it at a local server).
 */
export function createProxy({ allow, lookup = (host) => dnsLookup(host, { all: true, verbatim: true }), log = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`), dial = (address, port) => connect({ host: address, port }) } = {}) {
  const allowed = allow instanceof Set ? allow : parseAllow(allow)
  return createServer((client) => {
    let head = Buffer.alloc(0)
    let decided = false
    client.setTimeout(10_000)
    client.on("timeout", () => client.destroy())
    client.on("error", () => {})
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
      upstream.on("connect", () => {
        open = true
        log({ ev: "allowed", host })
        // A long model stream is quiet for a while; a tunnel idle for fifteen minutes is closed.
        upstream.setTimeout(15 * 60_000)
        client.setTimeout(15 * 60_000)
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        if (rest.length) upstream.write(rest)
        client.pipe(upstream)
        upstream.pipe(client)
        client.resume()
        client.on("close", () => upstream.destroy())
        upstream.on("close", () => client.destroy())
      })
    }
    client.on("data", onData)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? 3128)
  const server = createProxy({ allow: process.env.EVALS_EGRESS_ALLOW })
  server.listen(port, "0.0.0.0", () => process.stdout.write(`${JSON.stringify({ ev: "listening", port })}\n`))
  process.on("SIGTERM", () => process.exit(0))
}
