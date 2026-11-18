// evals-probe: asks the host to evaluate a permission and says what it decided. Nothing else.
//
//   tools.evalsprobe.assert_action({ action, resource?, session? })   one action: "allowed", "asked" (the ask was rejected),
//                                                                     "denied" or "hang" (no answer in 5 s)
//   tools.evalsprobe.assert_all({ actions, session? })                every action in one call: { <action>: outcome }
//
// `session: "global"` asks as the global session, which `opencode run --server` does not answer: the guard's responder must.
// The probe's own tools are not writes and call no vendor. They exist so the P0 probes can run with no credential, where a
// plugin that registers its tools only after sign-in has no tool to call, yet the host's decision for its action is the same.

const HANG_MS = 5000

export function classify(message: string): "asked" | "denied" | "error" {
  if (/cannot ask the user|request was rejected|rejected the permission|permission request/i.test(message)) return "asked"
  if (/denied|deny|EVALS-ASSERT|refused/i.test(message)) return "denied"
  return "error"
}

export function probePlugin(Plugin: { define: (definition: unknown) => unknown }) {
  return Plugin.define({
    id: "evals.probe",
    async setup(ctx: any) {
      const ask = async (action: string, resource: string, sessionID: string, agent: string) => {
        const started = Date.now()
        let timer: ReturnType<typeof setTimeout> | undefined
        const hang = new Promise<"hang">((resolve) => {
          timer = setTimeout(() => resolve("hang"), HANG_MS)
        })
        try {
          const done = ctx.permission.assert({ sessionID, agent, action, resources: [resource] }).then(
            () => ({ outcome: "allowed", message: "" }),
            (error: unknown) => {
              const message = String((error as Error)?.message ?? error)
              return { outcome: classify(message), message: message.slice(0, 160) }
            },
          )
          const winner = await Promise.race([done, hang])
          return winner === "hang" ? { outcome: "hang", message: `no answer in ${HANG_MS} ms`, ms: Date.now() - started } : { ...(winner as object), ms: Date.now() - started }
        } finally {
          if (timer) clearTimeout(timer)
        }
      }
      await ctx.tool.transform((editor: any) => {
        editor.namespace({ name: "evalsprobe", description: "Eval-only probes of the host's permission decisions. Not a vendor tool." })
        editor.add({
          name: "assert_action",
          description: "Asks the host to evaluate one permission action and reports allowed, asked, denied or hang.",
          input: { type: "object", properties: { action: { type: "string" }, resource: { type: "string" }, session: { type: "string" } }, required: ["action"], additionalProperties: false },
          output: { type: "object", additionalProperties: true },
          options: { namespace: "evalsprobe", permission: "evalsprobe_assert_action" },
          execute: async (value: any, context: any) => {
            const result = await ask(value.action, value.resource ?? "*", value.session === "global" ? "global" : context.sessionID, context.agent)
            return { output: result, content: JSON.stringify(result) }
          },
        })
        editor.add({
          name: "assert_all",
          description: "Asks the host about every action in the list and reports each one's outcome.",
          input: { type: "object", properties: { actions: { type: "array", items: { type: "string" } }, session: { type: "string" } }, required: ["actions"], additionalProperties: false },
          output: { type: "object", additionalProperties: true },
          options: { namespace: "evalsprobe", permission: "evalsprobe_assert_all" },
          execute: async (value: any, context: any) => {
            const outcomes: Record<string, string> = {}
            const slow: string[] = []
            for (const action of value.actions as string[]) {
              const result = await ask(action, "*", value.session === "global" ? "global" : context.sessionID, context.agent)
              outcomes[action] = result.outcome
              if (result.outcome === "hang") slow.push(action)
            }
            const tally: Record<string, number> = {}
            for (const outcome of Object.values(outcomes)) tally[outcome] = (tally[outcome] ?? 0) + 1
            const output = { tally, outcomes, hung: slow }
            return { output, content: JSON.stringify(output) }
          },
        })
      })
    },
  })
}
