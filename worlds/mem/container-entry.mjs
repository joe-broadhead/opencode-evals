// Memory fixture entry: container only. Importing this file never starts a listener.
import { createServer } from "node:http"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { openFixture } from "./fixture.mjs"
import { fixtureResponse, PORT } from "./http.mjs"

export async function serveFixture(root) {
  if (process.platform !== "linux" || !existsSync("/.dockerenv") || process.env.EVALS_MEM_CONTAINED !== "mem-synthetic-v1") throw new Error("Memory fixture is container only; host execution is refused")
  root = resolve(root)
  if (!existsSync(root) || lstatSync(root).isSymbolicLink()) throw new Error("fixture root is not a staged directory")
  const descriptor = JSON.parse(readFileSync(join(root, "descriptor.json"), "utf8"))
  if (descriptor.schema !== "oc-mem-fixture/1" || descriptor.fixture !== "mem-synthetic-v1" || descriptor.port !== PORT) throw new Error("invalid fixture descriptor")
  if(descriptor.transport==="discovery-v2"){
    const {serveDiscovery}=await import("./discovery-entry.mjs")
    return serveDiscovery(root)
  }
  if (descriptor.transport === "baseline-586") {
    const { serveBaseline } = await import("./baseline-entry.mjs")
    return serveBaseline(root)
  }
  const fixture = openFixture(root)
  const server = createServer(async (req, res) => {
    let bytes = 0, chunks = []
    try {
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 16384) throw new Error("request too large"); chunks.push(chunk) }
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
      const result = fixtureResponse(fixture, { method: req.method, path: req.url, headers: req.headers, body })
      res.writeHead(result.status, { "content-type": "application/json" }); res.end(JSON.stringify(result.body))
    } catch { res.writeHead(400, { "content-type": "application/json" }); res.end('{"error":"invalid bounded JSON request"}') }
  })
  await new Promise((done, fail) => { server.once("error", fail); server.listen(PORT, "127.0.0.1", done) })
  return server
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) await serveFixture(process.argv[2])
