// The guard's decisions, pure: the policy, the call and the plans recorded so far go in, a verdict comes out. Plain JavaScript,
// so the harness's tests import it as it is and the plugin (index.ts) imports it unchanged inside the host.

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const DEFAULT = { mode: "refuse", writes: [], actions: [] }

/** The policy file, or the safe default (refuse everything) when it cannot be read. */
export function loadPolicy(file) {
  try {
    const path = typeof file === "string" ? file : fileURLToPath(file)
    if (!existsSync(path)) return { ...DEFAULT }
    return { ...DEFAULT, ...JSON.parse(readFileSync(path, "utf8")) }
  } catch {
    // An unreadable policy refuses everything: the safe direction.
    return { ...DEFAULT }
  }
}

/** `args.channel_id`, `args.items.0.to`: a dotted path into a call's input. */
export function pick(input, path) {
  let at = input
  for (const part of String(path).replace(/^args\./, "").split(".")) {
    if (at === null || at === undefined) return undefined
    at = at[part]
  }
  return at
}

export function matchWrite(policy, tool) {
  const bare = String(tool).replace(/^mcp[._-]/, "")
  return policy.writes.find((write) => write.names.includes(tool) || write.names.includes(bare)) ?? null
}

export const isIn = (names, tool) => Boolean(names?.includes(tool) || names?.includes(String(tool).replace(/^mcp[._-]/, "")))

/** The planId a plan-maker returned, wherever it lies in its result (an object, or JSON text). */
export function planIdOf(result, idPath = "planId") {
  const seen = (value, depth) => {
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
    for (const child of Object.values(value)) {
      const found = seen(child, depth + 1)
      if (found) return found
    }
    return null
  }
  return seen(result, 0)
}

/**
 * Decides one call that reached execute.before. Outside the commit set nothing is refused here (the ask is what stops a
 * write: execute.before fires before the tool asks, so a refusal here would stop the ask from ever happening).
 * In the commit set a write passes only for a declared extractor and an allowed target, a plan commit only for a recorded plan.
 */
export function decideBefore(policy, tool, input, plans = new Map()) {
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
  const outside = list.filter((value) => !write.allow.includes(value))
  return outside.length ? { pass: false, why: "a target outside the sandbox", write, committer } : { pass: true, why: "an in-scope target", write, committer }
}

/** A plan the guard saw made: in scope when every target it names is an allowed alias value. */
export function judgePlan(policy, input) {
  const targets = (policy.plans?.targetPaths ?? []).flatMap((path) => {
    const value = pick(input, path)
    return value === undefined || value === null ? [] : Array.isArray(value) ? value.map(String) : [String(value)]
  })
  return { ok: targets.length > 0 && targets.every((target) => (policy.plans?.allow ?? []).includes(target)), targets: targets.length }
}
