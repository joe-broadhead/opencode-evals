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
//   * `permission.asked` is answered at once for every session, the "global" one included: `opencode run --server` answers
//     none of the global ones, so a run would hang.
//
// Everything is appended to EVALS_GUARD_OUT as JSON lines the runner reads after the trial. The policy comes from guard.json
// beside this file, which `evals run` writes read-only into the batch's own copy. The plugin API is passed in, so unit tests
// can run the logic against a stand-in.

import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export type Write = { names: string[]; action: string; extract?: string; allow?: string[] }
export type Plans = {
  /** The tools that make a plan (`gws_plan`): the id they return, and where the target lies in their input. */
  makers: string[]
  idPath?: string
  /** The tools that commit a plan by id alone (`gws_write`): the input key that holds the id. */
  committers: string[]
  commitKey?: string
  /** Where the target lies in the plan's input, and the aliases it may name. */
  targetPaths: string[]
  allow: string[]
}
export type Policy = {
  /** "refuse": no write is committed. "commit": only declared, in-scope writes pass. "log": observe only (probes). */
  mode: "refuse" | "commit" | "log"
  writes: Write[]
  /** Write permission actions (a write's ask is expected; its `allow` is an assertion failure). */
  actions: string[]
  plans?: Plans
}

const DEFAULT: Policy = { mode: "refuse", writes: [], actions: [] }

export function loadPolicy(file: string | URL): Policy {
  try {
    const path = typeof file === "string" ? file : fileURLToPath(file)
    if (!existsSync(path)) return DEFAULT
    return { ...DEFAULT, ...JSON.parse(readFileSync(path, "utf8")) }
  } catch {
    // An unreadable policy refuses everything: the safe direction.
    return { ...DEFAULT }
  }
}

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

/** `args.channel_id`, `args.items.0.to`: a dotted path into a call's input. */
export function pick(input: unknown, path: string): unknown {
  let at: any = input
  for (const part of path.replace(/^args\./, "").split(".")) {
    if (at === null || at === undefined) return undefined
    at = at[part]
  }
  return at
}

export function matchWrite(policy: Policy, tool: string) {
  const bare = String(tool).replace(/^mcp[._-]/, "")
  return policy.writes.find((write) => write.names.includes(tool) || write.names.includes(bare)) ?? null
}

const isIn = (names: string[] | undefined, tool: string) => Boolean(names?.includes(tool) || names?.includes(String(tool).replace(/^mcp[._-]/, "")))

/** The planId a plan-maker returned, wherever it lies in its result (an object, or JSON text). */
export function planIdOf(result: unknown, idPath = "planId"): string | null {
  const seen = (value: unknown, depth: number): string | null => {
    if (depth > 4 || value === null || value === undefined) return null
    if (typeof value === "string") {
      try {
        return seen(JSON.parse(value), depth + 1)
      } catch {
        return null
      }
    }
    if (typeof value !== "object") return null
    const direct = pick(value, idPath)
    if (typeof direct === "string" && direct) return direct
    for (const child of Object.values(value as object)) {
      const found = seen(child, depth + 1)
      if (found) return found
    }
    return null
  }
  return seen(result, 0)
}

/**
 * Decides one call that reached execute.before. Pure: the policy, the call and the plans recorded so far are passed in.
 * Outside the commit set nothing is refused here (the ask is what stops a write: see the top of this file).
 */
export function decideBefore(policy: Policy, tool: string, input: unknown, plans: Map<string, { ok: boolean }> = new Map()): { pass: boolean; why: string; write: Write | null; committer: boolean } {
  const write = matchWrite(policy, tool)
  const committer = isIn(policy.plans?.committers, tool)
  if (!write && !committer) return { pass: true, why: "not a write", write, committer }
  if (policy.mode !== "commit") return { pass: true, why: policy.mode === "log" ? "log mode" : "left to the ask", write, committer }
  if (committer && policy.plans) {
    const id = pick(input, policy.plans.commitKey ?? "planId")
    const plan = typeof id === "string" ? plans.get(id) : undefined
    return plan?.ok ? { pass: true, why: "a recorded in-sandbox plan", write, committer } : { pass: false, why: plan ? "a plan whose target is outside the sandbox" : "a plan id the guard never saw made", write, committer }
  }
  if (!write || !write.extract || !write.allow?.length) return { pass: false, why: "no target extractor declared for this write", write, committer }
  const target = pick(input, write.extract)
  if (target === undefined || target === null || target === "") return { pass: false, why: "no target in the call", write, committer }
  const list = Array.isArray(target) ? target.map(String) : [String(target)]
  const outside = list.filter((value) => !write.allow!.includes(value))
  return outside.length ? { pass: false, why: "a target outside the sandbox", write, committer } : { pass: true, why: "an in-scope target", write, committer }
}

/** Built by whatever host loads it: the plugin API is passed in, so this file imports nothing from the host. */
export function guardPlugin(Plugin: { define: (definition: unknown) => unknown }, policyFile: string | URL = new URL("./guard.json", import.meta.url)) {
  return Plugin.define({
    id: "evals.guard",
    async setup(ctx: any) {
      const policy = loadPolicy(policyFile)
      record("guard_start", { mode: policy.mode, writes: policy.writes.length, pid: process.pid })
      const actions = new Set(policy.actions)
      const plans = new Map<string, { ok: boolean }>()

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
        const decision = decideBefore(policy, event.tool, event.input, plans)
        record("execute_before", { tool: event.tool, call: event.id, session: event.sessionID, write: Boolean(decision.write) || decision.committer, pass: decision.pass, why: decision.why })
        if (!decision.pass) {
          record("assert", { what: "write", tool: event.tool, why: decision.why })
          throw new Error(`EVALS-ASSERT write: ${event.tool} refused (${decision.why})`)
        }
      })

      await ctx.tool.hook("execute.after", (event: any) => {
        const write = matchWrite(policy, event.tool)
        const committer = isIn(policy.plans?.committers, event.tool)
        // A plan maker's result carries the id; the plan is in scope when its target is an allowed alias.
        if (policy.plans && isIn(policy.plans.makers, event.tool) && event.status === "completed") {
          const id = planIdOf(event.result, policy.plans.idPath)
          if (id) {
            const targets = policy.plans.targetPaths.flatMap((path) => {
              const value = pick(event.input, path)
              return value === undefined || value === null ? [] : Array.isArray(value) ? value.map(String) : [String(value)]
            })
            const ok = targets.length > 0 && targets.every((target) => policy.plans!.allow.includes(target))
            plans.set(id, { ok })
            record("plan", { tool: event.tool, plan: id, in_scope: ok })
          }
        }
        if ((write || committer) && event.status === "completed") {
          record("committed", { tool: event.tool, call: event.id, session: event.sessionID, mode: policy.mode })
          if (policy.mode === "refuse") record("assert", { what: "committed", tool: event.tool })
        }
      })

      // The responder: every ask is rejected, the global ones too.
      void (async () => {
        try {
          for await (const event of ctx.event.subscribe({ types: ["permission.asked"] })) {
            const ask = (event as any).data
            record("ask", { action: ask.action, session: ask.sessionID, request: ask.id })
            try {
              await ctx.permission.reply({ sessionID: ask.sessionID, requestID: ask.id, decision: "reject" })
              record("reject", { action: ask.action, session: ask.sessionID, request: ask.id })
            } catch (error) {
              record("reject_failed", { action: ask.action, error: String((error as Error)?.message ?? error).slice(0, 200) })
            }
          }
        } catch (error) {
          record("responder_stopped", { error: String((error as Error)?.message ?? error).slice(0, 200) })
        }
      })()
    },
  })
}
