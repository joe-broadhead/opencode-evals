// An eval-only capture plugin. It observes three things and changes none of them:
//
//   permission  the rule the host resolved before a call (permission.hook("evaluate")), with the effect
//               it carried in and the effect this hook leaves behind;
//   tools       the tool list the plugin host holds, with each description's digest and size;
//   mcp         the arguments at the MCP boundary (execute.before) and how the call ended (execute.after).
//
// It never returns a decision and never assigns to the event it receives, so a run with it and a run
// without it are the same run. test/capture-nochange.test.mjs proves that against the same scripted
// session. Records are append-only JSONL in EVALS_CAPTURE_OUT, which lives in the private store.

import { appendFileSync } from "node:fs"
import { createHash } from "node:crypto"

const OUT = process.env.EVALS_CAPTURE_OUT ?? ""
const RUN = process.env.EVALS_RUN_ID ?? "run"

const sha = (value: string) => createHash("sha256").update(value).digest("hex")
const size = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null)
  return text ? text.length : 0
}

function write(kind: string, body: Record<string, unknown>): void {
  if (!OUT) return
  try {
    appendFileSync(OUT, JSON.stringify({ run: RUN, kind, at: Date.now(), ...body }) + "\n")
  } catch {
    // A capture failure must never fail a run: this plugin is an observer.
  }
}

/** Built by whatever host loads it: the plugin API is passed in, so this file imports nothing from the host. */
export function capturePlugin(Plugin: { define: (definition: unknown) => unknown }) {
  return Plugin.define({
  id: "evals.capture",
  async setup(ctx) {
    write("capture_start", { pid: process.pid, out: OUT })

    // 1. The resolved permission decision. The hook is read-only: it returns nothing and mutates nothing.
    let decisions = 0
    await ctx.permission.hook("evaluate", (evaluation) => {
      decisions++
      write("permission", {
        n: decisions,
        action: evaluation.action,
        resources: evaluation.resources,
        agent: evaluation.agent ?? null,
        session: evaluation.sessionID,
        effect_in: evaluation.effect,
        effect_out: evaluation.effect,
        message_in: evaluation.message ?? null,
        source: evaluation.source ?? null,
      })
      return undefined
    })

    // 2. The arguments at the MCP boundary, and how the call ended. `tool` and `input` are writable on
    //    this event; reading them and writing nothing is what makes the plugin an observer.
    await ctx.tool.hook("execute.before", (event) => {
      write("execute_before", {
        tool: event.tool,
        session: event.sessionID,
        agent: event.agent,
        call: event.id,
        message: event.messageID,
        args: event.input,
        args_sha256: sha(JSON.stringify(event.input ?? null)),
        args_bytes: size(event.input),
      })
    })

    await ctx.tool.hook("execute.after", (event) => {
      write("execute_after", {
        tool: event.tool,
        session: event.sessionID,
        agent: event.agent,
        call: event.id,
        status: event.status,
        args_sha256: sha(JSON.stringify(event.input ?? null)),
        has_result: event.status === "completed",
        result_keys: event.status === "completed" && event.result && typeof event.result === "object" ? Object.keys(event.result as object).sort() : [],
        result_bytes: event.status === "completed" ? size(event.result) : 0,
        error: event.status === "error" ? String((event.error as { message?: string } | undefined)?.message ?? event.error).slice(0, 200) : null,
      })
    })

    // 3. The tool list the host holds. A first snapshot at setup, and a second once the MCP servers have
    //    listed their tools: registration is asynchronous, so the later one is the record of what the model
    //    can be offered. Descriptions are digested, never stored.
    const snapshot = async (phase: string) => {
      const tools = await ctx.tool.list()
      write("tools", {
        phase,
        count: tools.length,
          tools: tools
          .map((tool) => ({
          id: tool.id,
          description_sha256: sha(String(tool.description ?? "")),
          description_bytes: size(tool.description),
          namespace: (tool.options as { namespace?: string } | undefined)?.namespace ?? null,
        }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      })
    }
    await snapshot("setup")
    const timer = setTimeout(() => void snapshot("late"), 9000)
    timer.unref?.()
  },
  })
}
