// The default export a real OpenCode host loads. The guard's logic lives in index.ts and takes the plugin API as an
// argument, so the unit tests can run it against a stand-in.
import { Plugin } from "@opencode/plugin"
import { guardPlugin } from "./index.ts"

export default guardPlugin(Plugin as never) as never
