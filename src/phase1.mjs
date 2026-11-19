// The credentialed phase's first steps, in the order of the G0 re-check's section D, as one gated sequence. Each step runs only if the
// one before it PASSED (recorded in `$EVALS_STORE/phase1.json`, so a stopped run resumes where it stopped), and the first failure stops
// everything with the sentence that says what to do. A HALT in the store stops it too, whichever step is next.
//
//   preflight   no HALT; the profile exists, has its own service port and no link; targets.json is there
//   check-real  after each vendor's sign-in to the evals profile: the REAL profile still works and the tokens differ (FAIL: sign the real
//               profile back in for that vendor and sign in no more)
//   keeper      P0-6: one identity read per signed-in vendor, a due token's expiry must move
//   p6c         P0-6c: `auth logout` of one vendor of the evals profile, only when asked (`--logout <vendor>`)
//   p7          P0-7: one scripted READ per plugin; the real egress hosts, recorded; no host refused
//   live        `p0 live`: one real write per plugin, guard on, one plugin at a time; declined is the pass, a completed write a HALT
//   gws         one real gws plan-and-commit in commit mode against the owner's sandbox
//   pilot       P0-8, the paid pilot, last: only with `--pilot --confirm-labels` (the lead has read the cases' Data: labels and
//               Seed: plugins=) and a ceiling set
//
// GitHub and Jira are not signed in (the owner's decision: `accounts: none` in their packs, or the store's round.json): no step below expects a
// sign-in for either, and their cases run with no credential. P0-6b (GitHub's token) is not a step any more.
//
// Nothing here runs a credential step by itself without being asked: `evals phase1` is the owner's or the lead's command, and
// `--dry-run` prints this order and what each step needs.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { readHalt, haltMessage } from "./run/halt.mjs"

export const STATE_FILE = "phase1.json"

const readJson = (file, fallback = null) => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback
  } catch {
    return fallback
  }
}

export const readState = (store) => readJson(join(store, STATE_FILE), { steps: {} })

function writeState(store, state) {
  mkdirSync(store, { recursive: true, mode: 0o700 })
  const file = join(store, STATE_FILE)
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(state, null, 1)}\n`, { mode: 0o600 })
  renameSync(tmp, file)
}

/** The plugin entries of a live-*.json file, in file order: ["slack", "linear", ...]. */
export const entriesOf = (store, name) => Object.keys(readJson(join(store, name), {})).filter((key) => key !== "_note")

const pass = (lines = []) => ({ ok: true, lines: [].concat(lines) })
const fail = (message, lines = []) => ({ ok: false, message, lines: [].concat(lines) })
const checksOf = (result) => result.checks.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}${c.ok ? "" : `: ${c.detail}`}`)

export const STEPS = [
  {
    id: "preflight",
    title: "no halt; the evals profile exists on its own service port with no link; targets.json is in the store",
    needs: "EVALS_PROFILE (the evals profile's directory), $EVALS_STORE/targets.json",
    async run(ctx) {
      const problems = []
      if (!ctx.profile || !existsSync(ctx.profile)) problems.push(`the evals profile ${ctx.profile ?? "(EVALS_PROFILE is not set)"} does not exist: run evals-profile.sh once`)
      else {
        const links = ctx.deps.linksIn(ctx.profile)
        if (links.length) problems.push(`a symbolic link under the profile: ${links[0]}`)
        try {
          ctx.deps.assertDistinctPort(ctx)
        } catch (error) {
          problems.push(error.message)
        }
      }
      if (!existsSync(join(ctx.store, "targets.json"))) problems.push(`${join(ctx.store, "targets.json")} does not exist: the sandbox aliases are the owner's`)
      return problems.length ? fail(problems.join("; ")) : pass("the profile is ready")
    },
  },
  {
    id: "check-real",
    title: "after each vendor's sign-in, check-real: the real profile still works and its tokens differ",
    needs: "--vendors a,b (or the vendors the profile holds), each signed in to the evals profile",
    async run(ctx) {
      const vendors = (ctx.vendors.length ? ctx.vendors : ctx.deps.signedIn(ctx)).filter((id) => !ctx.noAccount?.has(id))
      if (!vendors.length) return fail("the evals profile holds no signed-in vendor: sign one in with evals-profile.sh, then rerun")
      const lines = []
      for (const integration of vendors) {
        const result = ctx.deps.checkReal({ integration, opencode: ctx.opencode, profile: ctx.profile, store: ctx.store, env: ctx.caller })
        lines.push(result.line)
        if (!result.ok) return fail(`check-real failed for ${integration}: sign the real profile back in for ${integration} and sign in NO further vendor`, lines)
      }
      return pass(lines)
    },
  },
  {
    id: "keeper",
    title: "P0-6, the keeper: one identity read per signed-in vendor, and a due token's expiry moves",
    needs: "the vendors signed in",
    async run(ctx) {
      const results = ctx.deps.keepOnce({ opencode: ctx.opencode, profile: ctx.profile, store: ctx.store, env: ctx.caller, except: ctx.noAccount })
      if (!results.length) return fail("the keeper found no signed-in vendor to read")
      const lines = results.map((r) => `${r.ok ? "ok  " : "FAIL"} ${r.integration}${r.due ? (r.refreshed ? " (was due, refreshed)" : " (was due)") : ""}${r.why ? `: ${r.why}` : ""}`)
      const failed = results.filter((r) => !r.ok)
      return failed.length ? fail(`the keeper failed for ${failed.map((r) => r.integration).join(", ")}: its token did not read or did not refresh`, lines) : pass(lines)
    },
  },
  {
    id: "p6c",
    title: "P0-6c, logout: does `auth logout` call a vendor revoke (only when asked: --logout <vendor>)",
    needs: "--logout <vendor> (it signs the evals profile out of that vendor), the egress log watched",
    async run(ctx) {
      if (!ctx.logout) return pass("skipped: run `evals phase1 --only p6c --logout ashby` after the other steps (it signs the evals profile out of ashby; watch the egress log)")
      const out = ctx.deps.logout(ctx, ctx.logout)
      return out.ok ? pass(`logged ${ctx.logout} out of the evals profile (exit 0): record whether the egress log showed a revoke call`) : fail(`\`auth logout ${ctx.logout}\` failed in the evals profile (exit ${out.code})`)
    },
  },
  {
    id: "p7",
    title: "P0-7: one scripted read per plugin, the real egress hosts recorded, none refused",
    needs: "$EVALS_STORE/live-reads.json (read calls, @alias placeholders), the vendor caps in caps.json",
    async run(ctx) {
      const plugins = entriesOf(ctx.store, "live-reads.json").filter((id) => !ctx.noAccount?.has(id))
      if (!plugins.length) return fail(`${join(ctx.store, "live-reads.json")} names no plugin: write one read per signed-in plugin (X and OpenRouter reads cost money: one each)`)
      const lines = []
      for (const only of plugins) {
        const halt = readHalt(ctx.store)
        if (halt) return fail(haltMessage(halt), lines)
        const result = await ctx.deps.probe("p7", { only })
        lines.push(`${only}: ${result.ok ? "ok" : "FAIL"}`, ...checksOf(result).filter((l) => l.startsWith("FAIL")))
        if (!result.ok) return fail(`P0-7 failed for ${only}: ${result.checks.find((c) => !c.ok)?.name}`, lines)
      }
      return pass(lines)
    },
  },
  {
    id: "live",
    title: "p0 live: one real write per plugin at ask-changes, guard on, one plugin at a time; declined is the pass",
    needs: "$EVALS_STORE/live-writes.json (write calls with @alias placeholders)",
    async run(ctx) {
      const plugins = entriesOf(ctx.store, "live-writes.json").filter((id) => !ctx.noAccount?.has(id))
      if (!plugins.length) return fail(`${join(ctx.store, "live-writes.json")} names no plugin`)
      const lines = []
      for (const only of plugins) {
        const halt = readHalt(ctx.store)
        if (halt) return fail(haltMessage(halt), lines)
        const result = await ctx.deps.probe("live", { only })
        lines.push(`${only}: ${result.ok ? "declined, nothing written" : "FAIL"}`, ...checksOf(result).filter((l) => l.startsWith("FAIL")))
        if (!result.ok) return fail(`the live write probe failed for ${only}: ${result.checks.find((c) => !c.ok)?.name}. A completed write is a HALT: read it with \`evals halt\``, lines)
      }
      return pass(lines)
    },
  },
  {
    id: "gws",
    title: "one real gws plan-and-commit in commit mode, against the owner's sandbox folder and self address",
    needs: "$EVALS_STORE/live-gws.json (code and a commit plan naming @aliases)",
    async run(ctx) {
      const result = await ctx.deps.probe("gws", {})
      return result.ok ? pass(checksOf(result)) : fail(`the gws plan-and-commit failed: ${result.checks.find((c) => !c.ok)?.name}`, checksOf(result))
    },
  },
  {
    id: "pilot",
    title: "P0-8, the paid pilot, last: a ceiling set, the lead has read the 20 cases' Data: labels and Seed: plugins=",
    needs: "--pilot --confirm-labels, EVALS_ROUND_CEILING_USD, $EVALS_STORE/pilot.json (a list of `evals run` options)",
    async run(ctx) {
      const plan = readJson(join(ctx.store, "pilot.json"), null)
      if (!ctx.pilot || !ctx.confirmLabels) {
        const labels = (plan ?? []).flatMap((entry) => ctx.deps.labelsOf?.(entry) ?? [])
        return { ok: false, manual: true, message: "THE LEAD'S STEP: the pilot spends money. Read the labels below (3.1: the label is the writer's word), then rerun with --pilot --confirm-labels", lines: labels.length ? labels : [`${join(ctx.store, "pilot.json")}: ${plan ? `${plan.length} batch(es)` : "not written"}`] }
      }
      if (!ctx.caller.EVALS_ROUND_CEILING_USD) return fail("no EVALS_ROUND_CEILING_USD: the pilot is held to the plan's $10 or it does not run")
      if (!Array.isArray(plan) || !plan.length) return fail(`${join(ctx.store, "pilot.json")} is not a list of batches`)
      const lines = []
      for (const options of plan) {
        const result = await ctx.deps.runBatch(options)
        lines.push(`${options.plugin} ${options.iteration} on ${options.model}: launched ${result.launched} of ${result.planned}${result.stopped ? `; stopped: ${result.stopped}` : ""}`)
        if (result.stopped || result.bad) return fail(`the pilot batch ${options.iteration} stopped or had failures: ${result.stopped ?? `${result.bad} bad run(s)`}`, lines)
      }
      return pass(lines)
    },
  },
]

/** The default dependencies: the real modules, imported when a step needs them (the profile scripts live in the repository's scripts/). */
export async function defaultDeps({ store, caller, companions }) {
  const lib = await import("../scripts/profile/profile-lib.mjs")
  const { checkReal } = await import("../scripts/profile/check-real.mjs")
  const { keepOnce } = await import("../scripts/profile/keeper.mjs")
  const { assertDistinctPort } = await import("./run/service-port.mjs")
  const tmp = caller.EVALS_TMP ?? caller.TMPDIR
  return {
    linksIn: lib.linksIn,
    checkReal,
    keepOnce,
    assertDistinctPort: (ctx) => assertDistinctPort({ opencode: ctx.opencode, profileEnv: lib.profileEnv(ctx.profile, ctx.caller), realEnv: lib.realEnv(ctx.caller), env: ctx.caller }),
    signedIn: (ctx) => lib.SIGNIN_ORDER.filter((id) => !ctx.noAccount?.has(id)).filter((id) => {
      const out = lib.run(ctx.opencode, ["auth", "export", id], { env: lib.profileEnv(ctx.profile, ctx.caller) })
      return out.code === 0 && lib.activeCredential(out.stdout, id)
    }),
    credentialType: (ctx, id) => {
      const out = lib.run(ctx.opencode, ["auth", "export", id], { env: lib.profileEnv(ctx.profile, ctx.caller) })
      return out.code === 0 ? lib.activeCredential(out.stdout, id)?.value?.type ?? null : null
    },
    logout: (ctx, id) => {
      const out = lib.run(ctx.opencode, ["auth", "logout", id], { env: lib.profileEnv(ctx.profile, ctx.caller) })
      return { ok: out.code === 0, code: out.code }
    },
    probe: async (id, extra) => {
      const { PROBES } = await import("./p0/probes.mjs")
      return PROBES[id]({ companions, tmp, store, ...extra })
    },
    runBatch: async (options) => (await import("./run/runner.mjs")).runBatch({ ...options, auth: options.auth ?? "claude-agent+profile" }, { caller }),
    labelsOf: (entry) => {
      return [`${entry.plugin} ${entry.iteration}: cases ${entry.cases ?? "*"} on ${entry.model}`]
    },
  }
}

/**
 * Runs the sequence. `from` starts at a step (every step before it must have passed already), `only` runs just that one (the same rule).
 * Returns { ok, stopped: { id, message, manual } | null, ran: [{ id, ok, lines }] }.
 */
export async function runPhase1({ store, ctx, steps = STEPS, from = null, only = null, dryRun = false, reset = false, log = console.log, now = () => new Date().toISOString() }) {
  const ids = steps.map((s) => s.id)
  for (const wanted of [from, only]) if (wanted && !ids.includes(wanted)) throw new Error(`no step ${wanted}: ${ids.join(", ")}`)
  if (dryRun) {
    log("phase 1, the gated order (each step runs only if the one before it passed):")
    steps.forEach((s, i) => log(`  ${i + 1}. ${s.id.padEnd(10)} ${s.title}\n       needs: ${s.needs}`))
    return { ok: true, stopped: null, ran: [], dry: true }
  }
  const state = reset ? { steps: {} } : readState(store)
  const start = ids.indexOf(only ?? from ?? ids[0])
  // A step runs only if everything before it has passed.
  for (let i = 0; i < start; i++) {
    if (!state.steps[ids[i]]?.ok) {
      const message = `step ${ids[start]} needs ${ids[i]} to have passed first (it has not): run \`evals phase1\` from the start, or \`--from ${ids[i]}\``
      log(`STOP: ${message}`)
      return { ok: false, stopped: { id: ids[i], message }, ran: [] }
    }
  }
  const ran = []
  for (let i = start; i < steps.length; i++) {
    const step = steps[i]
    const halt = readHalt(store)
    if (halt) {
      const message = haltMessage(halt)
      log(`STOP before ${step.id}: ${message}`)
      return { ok: false, stopped: { id: step.id, message }, ran }
    }
    log(`[${i + 1}/${steps.length}] ${step.id}: ${step.title}`)
    let result
    try {
      result = await step.run(ctx)
    } catch (error) {
      result = fail(String(error.message ?? error))
    }
    for (const line of result.lines ?? []) log(`    ${line}`)
    state.steps[step.id] = { ok: Boolean(result.ok), at: now(), ...(result.ok ? {} : { message: result.message }) }
    writeState(store, state)
    ran.push({ id: step.id, ok: result.ok, lines: result.lines })
    if (!result.ok) {
      log(`${result.manual ? "STOP (a person's step)" : "STOP"} at ${step.id}: ${result.message}`)
      log(`nothing after ${step.id} ran. ${result.manual ? "Do it, then " : "Fix it, then "}rerun \`evals phase1 --from ${step.id}\``)
      return { ok: false, stopped: { id: step.id, message: result.message, ...(result.manual ? { manual: true } : {}) }, ran }
    }
    log(`    PASS ${step.id}`)
    if (only) break
  }
  if (!only || start === steps.length - 1) log("phase 1: every step passed")
  return { ok: true, stopped: null, ran }
}
