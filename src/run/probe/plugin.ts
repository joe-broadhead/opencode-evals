import { Plugin } from "@opencode/plugin"
import { probePlugin } from "./index.ts"

export default probePlugin(Plugin as never) as never
