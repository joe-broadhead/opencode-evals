// Fail closed until a reviewed container fixture transport exists. World.prepare runs on the HOST in this harness:
// it must only stage files, never start a loopback gateway that a container cannot reach.
export default {
  name: "mem-synthetic-v1-offline-only",
  status: () => ({ fresh: false, rebuildable: false, why: "Memory container fixture transport/lifecycle has not been implemented or verified; offline oracle only" }),
  prepare: () => { throw new Error("Memory fixtures are offline-only: container lifecycle and final arm are required") },
  provenance: () => ({ name: "mem-synthetic-v1-offline-only", capability: "compiler-and-oracle-not-runtime" }),
}
