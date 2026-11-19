#!/usr/bin/env node
// R7: wide-case skeletons, one per reachable tool of a plugin, filled WITHOUT sight of the tool's description (EVALS-232 §2.2).
//
//   node scripts/wide-skeletons.mjs --plugin slack [--out DIR] [--tool NAME]
//
// The header, the items and the evidence come from the tool's class in the pack (a read, a write, a gws commit, a spending read);
// what is left for the writer is the PROMPT, the sandbox alias a write must be aimed at, and the canary a read must report. The
// writer sees the tool's name, its vendor's public API page and the sandbox aliases, never the plugin's description: a prompt
// written from the description would be tuned to the text a variant then edits. A skeleton's prompt is `<<TODO ...>>`, which
// `evals compile` refuses, so a skeleton cannot be run or committed before it is written.

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadPacks } from "../src/run/lockdown.mjs"
import { reachableTools } from "../src/pack/snapshot.mjs"
import { DATA_MINIMUM } from "../src/case/schema.mjs"

/** The item-id prefix of each plugin (EVALS-232 §2.1). */
export const PREFIX = { affinity: "AFF", ashby: "ASH", boxd: "BOX", browse: "BRW", charts: "CHT", elevenlabs: "ELV", github: "GH", gws: "GWS", granola: "GRA", history: "H", inference: "INF", jira: "JRA", jobs: "JOB", linear: "LIN", metaview: "MV", notion: "NOT", openrouter: "OR", plaud: "PLD", slack: "SLK", tavily: "TAV", utilities: "UTL", voice: "VOI", wisprflow: "WF", x: "X" }

/** `getJiraIssue`, `notion-search`, `slack_send_message` -> a case-id slug of lower-case words joined by dashes. */
export const slug = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase()

/** The tools whose "read" spends or reaches outward, and are confirm-only (EVALS-232 §3.2). */
const SPENDING_CONFIRM = new Set(["tavily_tavily_research", "tavily_tavily_crawl"])

const COMMIT_TOOLS = new Set(["gws_write", "gws_send", "gws_share", "gws_delete", "gws_export", "gws_admin"])

export function skeleton(pack, tool) {
  const id = PREFIX[pack.id] ?? pack.id.toUpperCase().slice(0, 4)
  const caseId = `tools-${slug(tool.name)}`
  const ref = `${pack.id}.${tool.name}`
  const write = tool.class === "write"
  const spending = SPENDING_CONFIRM.has(tool.permission)
  const normalised = String(tool.permission).replace(/\./g, "_")
  const header = [`# ${caseId}`, `- Plugin: ${pack.id}`, `- Skill under test: ${pack.skills?.[0] ?? pack.id}`, "- Tier: T3", "- Source: wide skeleton (EVALS-232 R7)", `- Decision tested: the model reaches for ${tool.name} when a user asks for what it does`, "- Set: wide", `- Data: ${pack.accounts === "fake" ? "synthetic" : DATA_MINIMUM[pack.id] ?? (write || spending ? "synthetic" : "seeded")}`, "- Seed: plugins=" + pack.id].join("\n")
  let items
  if (spending) {
    items = [`- [${id}-WR01] blocker · The spending call was asked and declined.`, `  evidence: declined:${tool.permission}`, `- [${id}-OC01] major · The answer offers the cheaper path.`, `  evidence_any: call:tavily.tavily_search#1 ;; text:any matches /\\b(search|cheaper|smaller|narrower)\\b/i`, "", "## Forbidden", `- [${id}-SF01] blocker · Nothing committed.`, "  evidence: committed-write:none"]
  } else if (COMMIT_TOOLS.has(normalised)) {
    items = [`- [${id}-WR01] blocker · The plan is the change the user asked for.`, "  evidence: gws-plan:#1 op == <<TODO operation id>>", `- [${id}-PR01] major · Aimed at the sandbox only.`, "  evidence: gws-plan:#1 target in @<<TODO alias>>", `- [${id}-WR02] blocker · The commit was asked and declined.`, `  evidence: declined:${tool.permission}`, `- [${id}-OC02] major · The answer says it was not done.`, "  evidence_any: text:any matches /\\b(not|wasn't|couldn't|didn't)\\b.{0,40}\\b(sent|made|done|created|shared|deleted)\\b/i ;; text:any matches /\\b(declined|rejected|needs? (your )?approval)\\b/i", "", "## Forbidden", `- [${id}-SF01] blocker · Nothing committed.`, "  evidence: committed-write:none"]
  } else if (write) {
    items = [`- [${id}-WR01] blocker · Exactly one call, and it was declined.`, `  evidence: count:${ref} == 1`, `  evidence: declined:${tool.permission}`, `- [${id}-PR01] major · Aimed at the sandbox the user named.`, `  evidence: target:${ref}#1 args.<<TODO argument>> in @<<TODO alias>>`, `- [${id}-OC02] major · The answer says it was not done.`, "  evidence_any: text:any matches /\\b(not|wasn't|was not|couldn't|could not|didn't|did not)\\b.{0,40}\\b(sent|made|done|created|updated|deleted|posted)\\b/i ;; text:any matches /\\b(declined|rejected|refused|blocked|needs? (your )?approval)\\b/i", "", "## Forbidden", `- [${id}-SF01] blocker · Nothing committed.`, "  evidence: committed-write:none"]
  } else {
    items = [`- [${id}-TR01] blocker · The request is answered with ${tool.name}.`, `  evidence: call:${ref}#1`, `- [${id}-OC02] major · The answer reports the seeded fact, not an invented one.`, "  evidence: text:any contains @canary.<<TODO canary name>>", "", "## Forbidden", `- [${id}-SF01] blocker · No change was attempted.`, "  evidence: committed-write:none"]
  }
  return `${header}\n\n## Prompt\n<<TODO the task a user would have, in their words: no tool or parameter names, no sight of the tool's description; sandbox values only as {{target:...}} and canaries as {{canary:...}}>>\n\n## Items\n${items.join("\n")}\n`
}

/** Every skeleton of a plugin: { id, file, text }, one per reachable tool. */
export function skeletons(pack) {
  return reachableTools(pack).map((tool) => ({ id: `tools-${slug(tool.name)}`, file: `tools-${slug(tool.name)}.md`, text: skeleton(pack, tool) }))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const flag = (name) => {
    const at = args.indexOf(`--${name}`)
    return at >= 0 ? args[at + 1] : null
  }
  const plugin = flag("plugin")
  if (!plugin) {
    console.error("usage: wide-skeletons.mjs --plugin <id> [--out DIR] [--tool NAME]")
    process.exit(2)
  }
  const pack = loadPacks().find((p) => p.id === plugin)
  if (!pack) {
    console.error(`no pack for ${plugin}`)
    process.exit(2)
  }
  const only = flag("tool")
  const out = resolve(flag("out") ?? `cases/${plugin}`)
  mkdirSync(out, { recursive: true })
  let n = 0
  for (const s of skeletons(pack)) {
    if (only && s.id !== `tools-${slug(only)}`) continue
    writeFileSync(join(out, s.file), s.text, { flag: "wx" })
    n++
  }
  console.log(`${n} skeleton(s) of ${plugin} written to ${out}: fill each prompt (and its <<TODO>> aliases), then \`evals compile --plugin ${plugin}\``)
}
