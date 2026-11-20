// The binaries a trial gets: browse's MCP server is a Node script, so a trial that uses browse mounts Node at
// /opt/evals/bin/node; one that does not mounts none. The mount itself is the container backend's (see
// isolation.test.mjs); here is the choice, on the real `pluginsOf` reader of a case's Plugin: and Seed: plugins=.
import { test } from "node:test"
import assert from "node:assert/strict"
import { browseInTrial, trialBinaries } from "../src/run/runner.mjs"

const caseObject = (plugin, seed = null) => ({ plugin, seed })

test("browse is in the trial when it is the arm, its own case, or a seed of any selected case", () => {
  assert.equal(browseInTrial("browse", []), true, "browse is the plugin under test")
  assert.equal(browseInTrial("slack", [caseObject("browse")]), true, "a case of browse's own")
  assert.equal(browseInTrial("slack", [caseObject("slack", "plugins=slack,browse")]), true, "a seed naming browse as a companion")
  assert.equal(browseInTrial("slack", [caseObject("slack", "plugins=slack")]), false)
  assert.equal(browseInTrial("slack", []), false)
  // The seed parser is the harness's own: `plugins=a, b` with a space is the same list.
  assert.equal(browseInTrial("slack", [caseObject("slack", "plugins=granola, browse utc-hours=9-17")]), true)
})

test("Node is mounted for a browse trial only, and EVALS_NODE_BIN names it", () => {
  const base = { binary: "/opt/opencode" }
  assert.deepEqual(trialBinaries({ ...base }), { opencode: "/opt/opencode" }, "no node when browse is not in the trial")
  assert.equal(trialBinaries({ ...base, needsBrowse: true }).node, "node", "the default is node on PATH")
  assert.equal(trialBinaries({ ...base, needsBrowse: true, caller: { EVALS_NODE_BIN: "/usr/local/bin/node" } }).node, "/usr/local/bin/node")
  const all = trialBinaries({ ...base, needsClaude: true, needsBrowse: true, scripted: true, caller: { EVALS_CLAUDE_BIN: "/c", EVALS_NODE_BIN: "/n", EVALS_BUN: "/b" } })
  assert.deepEqual(all, { opencode: "/opt/opencode", claude: "/c", node: "/n", bun: "/b" }, "the other binaries are unchanged")
})
