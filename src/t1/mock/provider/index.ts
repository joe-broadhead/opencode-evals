// The scripted model, as a local provider plugin: one OpenAI-compatible provider on loopback, and it as
// the default model. Nothing else is registered, so the host cannot reach a real vendor.
import { Model, Plugin, Provider } from "@opencode/plugin"

const mock = process.env.SPIKE_MOCK_URL

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
