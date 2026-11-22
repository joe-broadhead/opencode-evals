// Pure guard/commit-plan calls only. This is not proof of OpenCode permission hooks or ask replies.
import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveCommitPlan } from "../src/run/commit-plan.mjs"
import { buildPolicy } from "../src/run/guard/policy.mjs"
import { decideBefore, matchWrite } from "../src/run/guard/logic.mjs"

const pack = { id: "mem", pluginId: "mem", rpc: "mem.tools", tools: ["remember", "page", "revise", "wiki", "commitments"].map((name) => ({ name, permission: `mem_${name}`, class: "write" })) }
const binding = { schema: "oc-mem-contained/1", fixture: "mem-synthetic-v1", backend: "container", origin: "http://127.0.0.1:4617" }
const plan = () => resolveCommitPlan({ actions: ["mem_remember", "mem_page"], writes: { mem_remember: { memory: "remember", allow: ["@mem.personal"] }, mem_page: { memory: "page", allow: ["@mem.personal"] } } }, new Map([["mem.personal", ["spc-eval-personal"]]]))

test("Memory's implicit personal write gets a reserved-alias extractor, never a local waiver", () => {
  const p = plan()
  const policy = buildPolicy({ mode: "commit", packs: [pack], commit: p.writes, locked: true, memoryBinding: binding })
  for (const tool of ["mem_remember", "mem.remember"]) {
    assert.equal(decideBefore(policy, tool, { content: "Quartz is green.", kind: "fact" }).pass, true)
    assert.equal(decideBefore(policy, tool, { content: "x", kind: "fact", space: "production" }).pass, false)
  }
  assert.equal(decideBefore(policy, "mem_page", { action: "write", path: "projects/quartz", content: "Quartz." }).pass, true)
  assert.equal(decideBefore(policy, "mem_page", { action: "write", path: "projects/quartz", content: "Quartz.", space: "shared" }).pass, false)
  assert.equal(decideBefore(policy, "mem_page", { action: "write", path: "../escape", content: "x" }).pass, false)
  assert.equal(matchWrite(policy, "mem_page", { action: "read", path: "projects/quartz" }), null)
  assert.equal(decideBefore(policy, "mem_page", { action: "invent" }).pass, false)
  const wiki = buildPolicy({ mode: "commit", packs: [pack], commit: { mem_wiki: { memory: "wiki", allow: ["spc-eval-personal"] } }, locked: true, memoryBinding: binding })
  assert.equal(decideBefore(wiki, "mem_wiki", { action: "write", wiki_id: "wiki-eval-shared", space: "personal", filename: "x.md", content: "x" }).pass, false)
  const revise = buildPolicy({ mode: "commit", packs: [pack], commit: { mem_revise: { memory: "revise", allow: ["spc-eval-personal"] } }, locked: true, memoryBinding: { ...binding, record_spaces: { rec_eval_1: "spc-eval-personal", rec_eval_2: "spc-eval-shared" } } })
  assert.equal(decideBefore(revise, "mem_revise", { action: "retire", id: "rec_eval_1" }).pass, true)
  assert.equal(decideBefore(revise, "mem_revise", { action: "retire", id: "rec_eval_2" }).pass, false)
  assert.equal(decideBefore(revise, "mem_revise", { action: "retire", ids: ["rec_eval_1", "rec_eval_2"] }).pass, false)
  assert.equal(decideBefore(revise, "mem_revise", { action: "retire", id: "rec_eval_3" }).pass, false)
})

test("an unbound/host Memory extractor and production-looking aliases are refused", () => {
  const policy = buildPolicy({ mode: "commit", packs: [pack], commit: plan().writes, locked: true })
  assert.equal(decideBefore(policy, "mem_remember", { content: "Quartz is green.", kind: "fact" }).pass, false)
  assert.throws(() => resolveCommitPlan({ actions: ["mem_remember"], writes: { mem_remember: { memory: "remember", allow: ["@mem.personal"] } } }, new Map([["mem.personal", ["real-space"]]])), /reserved/)
  assert.throws(() => resolveCommitPlan({ actions: ["slack_send"], writes: { slack_send: { memory: "remember", allow: ["@mem.personal"] } } }, new Map([["mem.personal", ["spc-eval-personal"]]])), /Memory/)
  assert.throws(() => resolveCommitPlan({ actions: ["mem_remember"], writes: { mem_remember: { local: true } } }, new Map()), /Memory/)
})

test("generic guard and target plans retain their deny-by-default behavior", () => {
  const other = { id: "demo", tools: [{ name: "save", permission: "demo_save", class: "write" }] }
  const noPlan = buildPolicy({ mode: "commit", packs: [other], locked: true })
  assert.equal(decideBefore(noPlan, "demo_save", { id: "x" }).pass, false)
  const p = resolveCommitPlan({ actions: ["demo_save"], writes: { demo_save: { extract: "args.id", allow: ["@demo.item"] } } }, new Map([["demo.item", ["safe-item"]]]))
  const configured = buildPolicy({ mode: "commit", packs: [other], commit: p.writes, locked: true })
  assert.equal(decideBefore(configured, "demo_save", { id: "safe-item" }).pass, true)
  assert.equal(decideBefore(configured, "demo_save", { id: "production" }).pass, false)
})
