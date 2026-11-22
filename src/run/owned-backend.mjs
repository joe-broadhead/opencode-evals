import { ownedSession } from "./owned-launch.mjs"
import { setProcessGroupMode } from "./sandbox.mjs"
const workPath = p => p === "/work" || typeof p === "string" && p.startsWith("/work/") && !p.split("/").includes("..")
const backends = new WeakSet()
export const isOwnedBackend = backend => backends.has(backend)

export function ownedContainerBackend(capability, { ready } = {}) {
  const session = ownedSession(capability)
  const describe = () => ({ backend: "container", execution_mode: "owned-container", container_id: session.descriptor.container_id, context: session.descriptor.context, config_proof: "parent-required", removal: "parent-required" })
  const backend = {
    name: "owned-container", confines: true, maxParallel: 1, parentRemovalRequired: true,
    describe, egress: () => null, async prepare() {}, async teardown() {}, async allGone() { return false },
    async enter({ sandbox }) {
      if (!workPath(sandbox?.root) || setProcessGroupMode() !== "inherited") throw new Error("owned local inherited process mode required")
      let left = false
      return {
        killed: null, get left() { return left }, parentRemovalRequired: true,
        wrap(spec) {
          if (!["/opt/evals/bin/node", "/opt/evals/bin/opencode"].includes(spec.command) || !workPath(spec.cwd) || Object.keys(spec.env ?? {}).some(k => /^(DOCKER_|LD_|DYLD_|NODE_OPTIONS|NODE_PATH)/.test(k))) throw new Error("owned trial requires local pinned commands and work paths")
          return spec
        },
        port: attempt => 4100 + attempt,
        ready: spec => { if (!ready) throw new Error("local readiness interface unavailable"); return ready(spec) },
        async oomKills() { return null }, async diagnose() { return null }, async leave() { left = true }, async gone() { return false }, describe,
      }
    },
  }
  backends.add(backend)
  return backend
}
