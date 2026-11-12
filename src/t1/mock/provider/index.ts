// The scripted model, as a local provider plugin: one OpenAI-compatible provider on loopback, and it as
// the default model. Nothing else is registered, so the host cannot reach a real vendor.
import { Model, Plugin, Provider } from "@opencode/plugin"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// `evals run` pins the endpoint in endpoint.json beside a per-batch copy of this file (read-only in a container), so a
// plugin under test, which shares this process and its environment, cannot repoint the scripted model by rewriting
// SPIKE_MOCK_URL before this module loads. T1 runs this directory as it is, with the variable.
const pinned = fileURLToPath(new URL("./endpoint.json", import.meta.url))
const mock = existsSync(pinned) ? (JSON.parse(readFileSync(pinned, "utf8")).url as string) : process.env.SPIKE_MOCK_URL

export default Plugin.define({
  id: "evals.mock",
  async setup(ctx) {
    if (!mock) throw new Error("SPIKE_MOCK_URL is not set")
    const providerID = Provider.ID.make("mock")
    await ctx.provider.transform((editor) => {
      editor.add({
        info: { ...Provider.Info.empty(providerID), name: "Mock", activation: "enabled", package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: mock, apiKey: "mock" } } as never,
        models: [{ ...Model.Info.default(providerID, Model.ID.make("m1")), name: "Mock 1" }],
      })
    })
    await ctx.model.transform((editor) => editor.default.set("mock", "m1"))
  },
})
