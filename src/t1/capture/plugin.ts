// The default export a real OpenCode host loads. The observer itself lives in index.ts and takes the plugin
// API as an argument, so the same code can run inside an embedded host that resolves the API itself.
import { Plugin } from "@opencode/plugin"
import { capturePlugin } from "./index.ts"

export default capturePlugin(Plugin as never) as never
