// evals-probe: asks the host to evaluate a permission and says what it decided. Nothing else.
//
//   tools.evalsprobe.assert_action({ action, resource?, session? })   one action: "allowed", "asked" (the ask was rejected),
//                                                                     "denied" or "hang" (no answer in 5 s)
//   tools.evalsprobe.assert_all({ actions, session? })                every action in one call: { <action>: outcome }
//
// `session: "global"` asks as a session the probe creates and no run owns (`permission.assert` takes only an existing session's id), which `opencode run --server` does not answer: the guard's responder must.
// The probe's own tools are not writes and call no vendor. They exist so the P0 probes can run with no credential, where a
// plugin that registers its tools only after sign-in has no tool to call, yet the host's decision for its action is the same.

const HANG_MS = 5000
// `permission.assert` takes only the id of a session that exists, so the review's "global" session is modelled by a session the
// probe creates and no run owns: `opencode run --server` answers asks for the session it started, and none for any other.
const FOREIGN = "foreign"

export function classify(message: string): "asked" | "denied" | "error" {
  // The host's own error names: a rejected ask is a DeclinedError, a deny rule a DeniedError.
  if (/DeclinedError|cannot ask the user|request was rejected|rejected the permission|permission request/i.test(message)) return "asked"
  if (/DeniedError|denied|deny|EVALS-ASSERT|refused/i.test(message)) return "denied"
  return "error"
}

export function probePlugin(Plugin: { define: (definition: unknown) => unknown }) {
  return Plugin.define({
    id: "evals.probe",
    async setup(ctx: any) {
      let foreign: string | undefined
      const foreignSession = async () => {
        if (foreign) return foreign
        const created: any = await ctx.session.create({ title: "evals-probe: a session no run owns" })
        foreign = String(created?.data?.id ?? created?.id)
        return foreign
      }
      const ask = async (action: string, resource: string, requested: string, agent: string) => {
        const sessionID = requested === FOREIGN ? await foreignSession() : requested
        const started = Date.now()
        let timer: ReturnType<typeof setTimeout> | undefined
        const hang = new Promise<"hang">((resolve) => {
          timer = setTimeout(() => resolve("hang"), HANG_MS)
        })
        try {
          const done = ctx.permission.assert({ sessionID, agent, action, resources: [resource] }).then(
            () => ({ outcome: "allowed", message: "" }),
            (error: unknown) => {
              const e = error as { message?: unknown; name?: unknown; _tag?: unknown; cause?: unknown }
              let message = String(e?.message ?? "")
              if (!message) {
                try {
                  message = `${String(e?._tag ?? e?.name ?? "")} ${JSON.stringify(error)}`
                } catch {
                  message = String(error)
                }
              }
              return { outcome: classify(message), message: message.slice(0, 200) }
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
            const result = await ask(value.action, value.resource ?? "*", value.session === "global" ? FOREIGN : context.sessionID, context.agent)
            return { output: result, content: JSON.stringify(result) }
          },
        })
        editor.add({
          name: "list_namespaces",
          description: "Lists the tool namespaces the host holds, with how many tools each has: which plugins loaded.",
          input: { type: "object", properties: {}, additionalProperties: false },
          output: { type: "object", additionalProperties: true },
          options: { namespace: "evalsprobe", permission: "evalsprobe_list_namespaces" },
          execute: async () => {
            const tools = await ctx.tool.list()
            const namespaces: Record<string, number> = {}
            for (const tool of tools) {
              const ns = (tool.options as { namespace?: string } | undefined)?.namespace ?? "(none)"
              namespaces[ns] = (namespaces[ns] ?? 0) + 1
            }
            const output = { namespaces, tools: tools.length }
            return { output, content: JSON.stringify(output) }
          },
        })
        editor.add({
          name: "agent_rules",
          description: "Reports the wildcard permission rules the calling agent holds (`slack_*`, `voice_*`): which plugins loaded and what access each one applied.",
          input: { type: "object", properties: {}, additionalProperties: false },
          output: { type: "object", additionalProperties: true },
          options: { namespace: "evalsprobe", permission: "evalsprobe_agent_rules" },
          execute: async (_value: any, context: any) => {
            const info = await ctx.agent.get({ agentID: context.agent })
            const rules: { action: string; resource: string; effect: string }[] = (info?.data?.permissions ?? info?.permissions ?? []) as never
            const wildcards: Record<string, string[]> = {}
            for (const rule of rules) if (String(rule.action).endsWith("*") && rule.action !== "*") (wildcards[rule.action] ??= []).push(`${rule.resource}:${rule.effect}`)
            const output = { agent: context.agent, rules: rules.length, wildcards }
            return { output, content: JSON.stringify(output) }
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
              const result = await ask(action, "*", value.session === "global" ? FOREIGN : context.sessionID, context.agent)
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
