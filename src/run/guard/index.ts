// evals-guard (R4, R11): an eval-only plugin that is deny-by-default for every write tool and answers every permission ask.
//
// Where each decision is made (found by probes P0-4 and P0-A2 on OpenCode 2.3.2):
//   * `execute.before` fires for every call, inner Code Mode calls included (as `<plugin>_<tool>`), and BEFORE the tool asks
//     for its permission. A guard that refused every write there would stop the ask from ever happening, and a write graded
//     as "asked and declined" would never be asked. So outside the commit set the guard does not refuse at `execute.before`.
//   * `permission.evaluate` is where a write is stopped: a write action that resolves to `allow` was not asked, so the access
//     mode did not hold: the guard turns it into a deny and logs `EVALS-ASSERT access`. An ask is left alone (the host rejects
//     it and the recording says "declined").
//   * `execute.after` is the tripwire: a write tool whose call completed outside the commit set means a write got past both,
//     logged `EVALS-ASSERT committed`. The runner halts every batch on one.
//   * In the commit set (mode "commit") `execute.before` does refuse: a write passes only for a tool with a declared target
//     extractor whose extracted target is an allowed alias, and a plan-committed write (gws) only for a recorded plan.
//   * `permission.asked`: a session the guard has seen make a tool call is a run's own, and `opencode run` answers its asks with
//     the host's informative message ("cannot ask the user for permission, so the request was rejected"), which the model reads and
//     the grader keys on: the guard leaves those alone, and rejects one still pending after 3 s. Any other session, the "global" one
//     included, is rejected at once: `opencode run --server` answers none of those, so a run would hang.
//
// Everything is appended to EVALS_GUARD_OUT as JSON lines the runner reads after the trial. The policy comes from guard.json
// beside this file, which `evals run` writes read-only into the batch's own copy. The plugin API is passed in, so unit tests
// can run the logic against a stand-in.

import { appendFileSync } from "node:fs"
import { loadPolicy, matchWrite, isIn, planIdOf, decideBefore, judgePlan, pick } from "./logic.mjs"

const OUT = () => process.env.EVALS_GUARD_OUT ?? (process.env.TMPDIR ? `${process.env.TMPDIR}/guard.jsonl` : "")

export function record(kind: string, body: Record<string, unknown>): void {
  const out = OUT()
  if (!out) return
  try {
    appendFileSync(out, JSON.stringify({ kind, at: Date.now(), ...body }) + "\n")
  } catch {
    // The guard must never fail a run by failing to write its log.
  }
}

/** Built by whatever host loads it: the plugin API is passed in, so this file imports nothing from the host. */
export function guardPlugin(Plugin: { define: (definition: unknown) => unknown }, policyFile: string | URL = new URL("./guard.json", import.meta.url)) {
  return Plugin.define({
    id: "evals.guard",
    async setup(ctx: any) {
      const policy = loadPolicy(policyFile)
      record("guard_start", { mode: policy.mode, writes: policy.writes.length, pid: process.pid })
      const actions = new Set<string>(policy.actions)
      const plans = new Map<string, { ok: boolean }>()
      // The sessions that have made a tool call: a run's own, whose asks `opencode run` answers.
      const runSessions = new Set<string>()

      await ctx.permission.hook("evaluate", (evaluation: any) => {
        const write = actions.has(evaluation.action)
        record("permission", { action: evaluation.action, session: evaluation.sessionID, effect: evaluation.effect, write })
        if (write && evaluation.effect === "allow" && policy.mode === "refuse") {
          evaluation.effect = "deny"
          evaluation.message = `EVALS-ASSERT access: ${evaluation.action} is a write and was not asked`
          record("assert", { what: "access", action: evaluation.action, session: evaluation.sessionID })
        }
      })

      await ctx.tool.hook("execute.before", (event: any) => {
        runSessions.add(event.sessionID)
        const decision = decideBefore(policy, event.tool, event.input, plans)
        record("execute_before", { tool: event.tool, call: event.id, session: event.sessionID, write: Boolean(decision.write) || decision.committer, pass: decision.pass, why: decision.why })
        if (!decision.pass) {
          record("assert", { what: (decision as any).tool ? "tool" : "write", tool: event.tool, why: decision.why })
          throw new Error(`EVALS-ASSERT ${(decision as any).tool ? "tool" : "write"}: ${event.tool} refused (${decision.why})`)
        }
      })

      await ctx.tool.hook("execute.after", (event: any) => {
        const write = matchWrite(policy, event.tool)
        const committer = isIn(policy.plans?.committers, event.tool)
        if (policy.plans && isIn(policy.plans.makers, event.tool) && event.status === "completed") {
          const id = planIdOf(event.result, policy.plans.idPath)
          if (id) {
            const judged = judgePlan(policy, event.input)
            plans.set(id, { ok: judged.ok })
            record("plan", { tool: event.tool, plan: id, in_scope: judged.ok })
          }
        }
        if ((write || committer) && event.status === "completed") {
          record("committed", { tool: event.tool, call: event.id, session: event.sessionID, mode: policy.mode, ...(write?.extract ? { target: pick(event.input, write.extract) } : {}) })
          if (policy.mode === "refuse") record("assert", { what: "committed", tool: event.tool })
        }
      })

      // The responder: an ask of a session that is not a run's own is rejected at once, the global one included; a run's own is
      // left to `opencode run` and rejected here only if it is still pending after 3 s.
      void (async () => {
        const reject = async (ask: any, why: string) => {
          try {
            await ctx.permission.reply({ sessionID: ask.sessionID, requestID: ask.id, decision: "reject" })
            record("reject", { action: ask.action, session: ask.sessionID, request: ask.id, why })
          } catch (error) {
            // A reply to an ask someone else already answered fails: that is the normal end of a left-alone ask.
            if (why === "slow") return
            record("reject_failed", { action: ask.action, error: String((error as Error)?.message ?? error).slice(0, 200) })
          }
        }
        try {
          for await (const event of ctx.event.subscribe({ types: ["permission.asked"] })) {
            const ask = (event as any).data
            const own = runSessions.has(ask.sessionID)
            record("ask", { action: ask.action, session: ask.sessionID, request: ask.id, own })
            if (!own) void reject(ask, "foreign")
            else setTimeout(() => void reject(ask, "slow"), 3000).unref?.()
          }
        } catch (error) {
          record("responder_stopped", { error: String((error as Error)?.message ?? error).slice(0, 200) })
        }
      })()
    },
  })
}
