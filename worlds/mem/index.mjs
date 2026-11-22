// Filesystem preparation only. The native runner starts the closed service exclusively inside its container.
import {mkdirSync} from "node:fs"
export default {
  name: "mem-synthetic-v1",
  status: () => ({ fresh: true, rebuildable: false, why: "finite source-controlled fixture plan; runtime compatibility is not verified" }),
  prepare: ({sandbox}) => {mkdirSync(sandbox.project,{recursive:true,mode:0o700});return {cwd:sandbox.project,memFixture:true}},
  provenance: () => ({ name: "mem-synthetic-v1", capability: "finite-offline-contracts", runtime_verified:false }),
}
