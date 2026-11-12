// Builds the Charts world: one working directory per case family under repos/, each with the synthetic data in
// fixtures/data/, and, for the revision cases, a chart saved by the build under test (EVALS_WORLD_ARM) through its
// own tools RPC on a stock OpenCode host: no model, no network, no credential. A saved chart's generation folder is
// named by its content digest, so the build, not this file, decides those paths; the cases find the saved chart.
//
// Usage (the runner does this when the world is stale): EVALS_WORLD_ARM=<built plugin dir> node build.mjs
// Needs a stock binary (OPENCODE_BIN_<version> or EVALS_STOCK_DIR) and bun, as the T1 tier does.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { availableVersions, startHost, stopAll } from "../../src/t1/harness.mjs"
import { createSession } from "../../src/t1/checks.mjs"
import { call } from "../../src/t1/http.mjs"

const here = resolve(import.meta.dirname)
const data = join(here, "fixtures", "data")
const repos = join(here, "repos")
const arm = process.env.EVALS_WORLD_ARM
if (!arm || !existsSync(join(arm, "dist", "index.js"))) {
  console.error("build.mjs: set EVALS_WORLD_ARM to a built opencode-charts (a folder with dist/index.js)")
  process.exit(2)
}

/** The data every working directory starts with; sales-changed.csv is only ever the changed source of one repo. */
const SHARED = readdirSync(data).filter((file) => file.endsWith(".csv") && file !== "sales-changed.csv")

const recipe = (recipe, path, bindings, options, title) => ({ version: 1, chart: { kind: "recipe", recipe, data: { path }, bindings, ...(options ? { options } : {}) }, title })

/** The saved charts: the working directory each goes into, its file stem and its document. */
const SAVED = [
  { repo: "saved-bar", name: "revenue-by-region", document: recipe("bar", "data/sales.csv", { category: "region", value: "revenue_eur" }, { aggregate: "sum", yTitle: "Revenue (€)" }, "Revenue by region, Q1 2024") },
  { repo: "saved-bar-changed", name: "revenue-by-region", document: recipe("bar", "data/sales.csv", { category: "region", value: "revenue_eur" }, { aggregate: "sum", yTitle: "Revenue (€)" }, "Revenue by region, Q1 2024"), changed: { "data/sales.csv": "sales-changed.csv" } },
  { repo: "saved-line", name: "daily-active-users", document: recipe("line", "data/daily.csv", { x: "date", y: "active_users" }, { xType: "temporal", yTitle: "Daily active users" }, "Daily active users, Jan–Feb 2024") },
  { repo: "saved-scatter", name: "spend-vs-conversions", document: recipe("scatter", "data/campaigns.csv", { x: "spend_k", y: "conversions", series: "channel" }, { xTitle: "Spend (€k)", yTitle: "Conversions" }, "Spend against conversions by channel") },
  { repo: "saved-pie", name: "visits-by-channel", document: recipe("pie", "data/channels.csv", { category: "channel", value: "visits" }, { sort: "value-descending" }, "Visits by channel") },
]

const fresh = (dir) => {
  mkdirSync(join(dir, ".git"), { recursive: true })
  mkdirSync(join(dir, "data"), { recursive: true })
  for (const file of SHARED) cpSync(join(data, file), join(dir, "data", file))
}

rmSync(repos, { recursive: true, force: true })
fresh(join(repos, "data"))

const version = availableVersions()[0]
if (!version) {
  console.error("build.mjs: no stock OpenCode binary; set OPENCODE_BIN_<version> or EVALS_STOCK_DIR")
  process.exit(2)
}
const runDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "charts-world-"))
const made = []
try {
  // The T1 host copies a build's scripts and skills; Charts also needs its rasteriser, HTML runtimes and fonts, so the
  // whole build goes in first and the host's copy adds nothing new.
  for (const part of ["dist", "assets", "skills"]) if (existsSync(join(arm, part))) cpSync(join(arm, part), join(runDir, "plugin", part), { recursive: true })
  const host = await startHost({ version, plugin: { repo: arm, name: "charts" }, runDir, runId: "charts-world" })
  mkdirSync(join(host.project, "data"), { recursive: true })
  for (const file of SHARED) cpSync(join(data, file), join(host.project, "data", file))
  const session = await createSession(host)
  for (const saved of SAVED) {
    const response = await call(`${host.url}/api/rpc/charts.tools/quick`, {
      method: "POST",
      body: { input: { sessionID: session, input: { document: saved.document, name: saved.name } } },
      headers: { "x-opencode-directory": host.project },
      timeoutMs: 120_000,
    })
    const output = response.json?.output?.output ?? response.json?.output
    const folder = output?.generation?.directory
    if (!response.ok || !folder || !output?.files?.document) throw new Error(`charts_quick for ${saved.repo} failed: ${response.status} ${String(response.text ?? "").slice(0, 400)}`)
    const dir = join(repos, saved.repo)
    fresh(dir)
    mkdirSync(dirname(join(dir, folder)), { recursive: true })
    cpSync(join(host.project, folder), join(dir, folder), { recursive: true })
    for (const [target, source] of Object.entries(saved.changed ?? {})) cpSync(join(data, source), join(dir, target))
    made.push({ repo: saved.repo, document: output.files.document, revision: output.revision })
  }
} finally {
  await stopAll()
  if (made.length === SAVED.length) rmSync(runDir, { recursive: true, force: true })
  else console.error(`build.mjs: the host run is kept for inspection in ${runDir}`)
}
writeFileSync(join(here, "truth.json"), `${JSON.stringify({ host: version, saved: made }, null, 1)}\n`)
console.log(`charts world: ${made.length} saved charts on OpenCode ${version}`)
