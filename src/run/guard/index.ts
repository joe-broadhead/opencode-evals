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

import { appendFileSync, writeFileSync, renameSync } from "node:fs"
import { loadPolicy, matchWrite, isIn, isUnknownTool, planIdOf, decideBefore, judgePlan, pick, scalarLeaves, newIds } from "./logic.mjs"
import { memoryReply, refreshMemoryScopes, refreshMemoryTurn } from "./mem-permissions.mjs"
import { memoryCall } from "./mem-targets.mjs"
import { memoryPermissionContext } from "./mem-call-context.mjs"

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
      record("guard_start", { mode: policy.mode, writes: policy.writes.length, pid: process.pid, ...(policy.memoryIntent?{case_id:policy.memoryIntent.case_id,trial_id:policy.memoryIntent.trial_id}:{}) })
      const actions = new Set<string>(policy.actions)
      const plans = new Map<string, { ok: boolean }>()
      // The sessions that have made a tool call: a run's own, whose asks `opencode run` answers.
      const runSessions = new Set<string>()
      const memoryCalls = new Map<string, any>()
      const registrations: any[] = []
      const timers = new Set<ReturnType<typeof setTimeout>>()
      const subscription = new AbortController()
      let closed = false
      const refreshTurn = () => {
        try { refreshMemoryTurn(policy, process.env.EVALS_MEM_TURN_STATE) }
        catch (error) { policy.memoryContext=null; record("memory_context_invalid", {error:String(error).slice(0,200)}) }
      }
      const activeReceipt = (value: any) => {
        const file = process.env.EVALS_MEM_ACTIVE_CALL
        if (!file || !policy.memoryIntent) return
        writeFileSync(`${file}.tmp`, JSON.stringify(value), {mode:0o600})
        renameSync(`${file}.tmp`, file)
      }

      registrations.push(await ctx.permission.hook("evaluate", (evaluation: any) => {
        refreshTurn()
        const unknown = !actions.has(evaluation.action) && isUnknownTool(policy, evaluation.action)
        const memory = memoryPermissionContext(policy, evaluation, memoryCalls, closed)
        const write = memory ? memory.write : actions.has(evaluation.action) || unknown
        record("permission", { action: evaluation.action, session: evaluation.sessionID, effect: evaluation.effect, write, ...(unknown ? { unknown: true } : {}) })
        if (memory && !memory.pass && evaluation.effect !== "deny") {
          evaluation.effect = "deny"
          evaluation.message = "EVALS-ASSERT access: no active validated Memory invocation"
        } else if (write && evaluation.effect === "allow" && policy.mode === "refuse") {
          evaluation.effect = "deny"
          evaluation.message = `EVALS-ASSERT access: ${evaluation.action} is a write and was not asked`
          record("assert", { what: "access", action: evaluation.action, session: evaluation.sessionID })
        }
      }))

      registrations.push(await ctx.tool.hook("execute.before", (event: any) => {
        if (closed && memoryCall(event.tool, event.input, policy.memoryBinding)) throw new Error("Memory trial guard is disposed")
        runSessions.add(event.sessionID)
        refreshTurn()
        if (policy.memoryBinding) refreshMemoryScopes(policy, process.env.EVALS_MEM_SCOPE_MAP)
        const decision = decideBefore(policy, event.tool, event.input, plans, event)
        if (policy.memoryBinding) {
          const call = memoryCall(event.tool, event.input, policy.memoryBinding)
          if (call?.write && [...memoryCalls.values()].some((c) => c.classification?.write)) throw new Error("Memory intent forbids concurrent write invocations")
          if (call) memoryCalls.set(`${event.sessionID}:${event.id}`, { tool: event.tool, input: structuredClone(event.input), sessionID: event.sessionID, classification: call, pass: decision.pass, target: call.target, context: structuredClone(policy.memoryContext??null) })
          if (call?.write && decision.pass) activeReceipt({...policy.memoryContext,tool:event.tool,family:call.family,args:event.input,call_id:event.id,pass:true})
        }
        // A write's input leaves, for `target: ... in created`: the value the tool really got, a variable resolved (private, like the rest of this log).
        const args = matchWrite(policy, event.tool, event.input) ? { args: scalarLeaves(event.input) } : {}
        record("execute_before", { tool: event.tool, call: event.id, session: event.sessionID, write: Boolean(decision.write) || decision.committer, pass: decision.pass, why: decision.why, ...args })
        if (!decision.pass) {
          memoryCalls.delete(`${event.sessionID}:${event.id}`)
          record("assert", { what: (decision as any).tool ? "tool" : "write", tool: event.tool, why: decision.why })
          throw new Error(`EVALS-ASSERT ${(decision as any).tool ? "tool" : "write"}: ${event.tool} refused (${decision.why})`)
        }
      }))

      registrations.push(await ctx.tool.hook("execute.after", (event: any) => {
        if (memoryCalls.get(`${event.sessionID}:${event.id}`)?.classification?.write) activeReceipt(null)
        memoryCalls.delete(`${event.sessionID}:${event.id}`)
        const write = matchWrite(policy, event.tool, event.input)
        const unknown = !write && isUnknownTool(policy, event.tool)
        const committer = isIn(policy.plans?.committers, event.tool)
        if (policy.plans && isIn(policy.plans.makers, event.tool) && event.status === "completed") {
          const id = planIdOf(event.result, policy.plans.idPath)
          if (id) {
            const judged = judgePlan(policy, event.input)
            plans.set(id, { ok: judged.ok })
            record("plan", { tool: event.tool, plan: id, in_scope: judged.ok })
          }
        }
        if ((write || committer || unknown) && event.status === "completed") {
          record("committed", { tool: event.tool, call: event.id, session: event.sessionID, mode: policy.mode, ...(unknown ? { unknown: true } : {}), ...(write?.extract ? { target: pick(event.input, write.extract) } : {}) })
          if (policy.mode === "refuse") record("assert", { what: "committed", tool: event.tool })
        }
        // The id a completed write's own result gives to the thing it made (a create's new id; an update adds none). Written AFTER the safety records, and never able to stop them: a result this
        // cannot read says so and records no id (review of #14, K3).
        if (write && event.status === "completed") {
          try {
            record("write_result", { tool: event.tool, call: event.id, session: event.sessionID, ids: newIds(event.result, event.input, { tool: event.tool }) })
          } catch (error) {
            record("write_result", { tool: event.tool, call: event.id, session: event.sessionID, ids: [], error: String((error as any)?.message ?? error).slice(0, 200) })
          }
        }
      }))

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
          for await (const event of ctx.event.subscribe({ types: ["permission.asked"], signal: subscription.signal })) {
            if (closed) break
            const ask = (event as any).data
            refreshTurn()
            const own = runSessions.has(ask.sessionID)
            record("ask", { action: ask.action, session: ask.sessionID, request: ask.id, own })
            const memoryDecision = memoryReply(policy, ask, memoryCalls)
            if (memoryDecision !== null) {
              try {
                await ctx.permission.reply({ sessionID: ask.sessionID, requestID: ask.id, decision: memoryDecision })
                record("memory_reply", { action: ask.action, session: ask.sessionID, request: ask.id, decision: memoryDecision })
              } catch (error) { record("memory_reply_failed", { action: ask.action, error: String((error as Error)?.message ?? error).slice(0,200) }) }
              continue
            }
            if (!own) void reject(ask, "foreign")
            else {
              const timer = setTimeout(() => { timers.delete(timer); if (!closed) void reject(ask, "slow") }, 3000)
              timer.unref?.()
              timers.add(timer)
            }
          }
        } catch (error) {
          record("responder_stopped", { error: String((error as Error)?.message ?? error).slice(0, 200) })
        }
      })()
      return async () => {
        if (closed) return
        closed = true
        activeReceipt(null)
        subscription.abort()
        for (const timer of timers) clearTimeout(timer)
        timers.clear()
        memoryCalls.clear()
        runSessions.clear()
        plans.clear()
        delete policy.memoryContext
        delete policy.memoryCreators
        for (const registration of registrations) {
          if (typeof registration === "function") await registration()
          else await registration?.dispose?.()
        }
      }
    },
  })
}
