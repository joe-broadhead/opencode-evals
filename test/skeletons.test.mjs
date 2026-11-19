// R7: wide skeletons, one per reachable tool, from the pack's class; their prompts are `<<TODO>>`, which compile refuses.
import { test } from "node:test"
import assert from "node:assert/strict"
import { skeletons, skeleton, slug, PREFIX } from "../scripts/wide-skeletons.mjs"
import { compileCase } from "../src/case/compile.mjs"
import { loadPacks } from "../src/run/lockdown.mjs"

const packs = loadPacks()
const pack = (id) => packs.find((p) => p.id === id)
const fill = (text, replacements) => Object.entries({ "<<TODO the task a user would have, in their words: no tool or parameter names, no sight of the tool's description; sandbox values only as {{target:...}} and canaries as {{canary:...}}>>": "Please do the thing for me.", ...replacements }).reduce((t, [from, to]) => t.replace(from, to), text)

test("a slug is lower-case words joined by dashes, whatever the tool's spelling", () => {
  assert.equal(slug("getJiraIssue"), "get-jira-issue")
  assert.equal(slug("notion-search"), "notion-search")
  assert.equal(slug("slack_send_message"), "slack-send-message")
  assert.equal(Object.keys(PREFIX).length, 24)
  for (const id of packs.map((p) => p.id)) assert.ok(PREFIX[id], `${id} has an item-id prefix`)
})

test("one skeleton per reachable tool, hidden ones left out, and none compiles until its prompt is written", () => {
  const granola = pack("granola")
  const all = skeletons(granola)
  assert.equal(all.length, granola.counts.tools - (granola.counts.hidden ?? 0))
  assert.equal(all.some((s) => s.id === "tools-sign-out"), false, "a hidden tool has no case")
  for (const p of packs) assert.equal(skeletons(p).length, p.tools.filter((t) => !t.hidden).length, p.id)
  const s = all[0]
  assert.throws(() => compileCase(`cases/granola/${s.file}`, s.text), /the prompt is still a skeleton's <<TODO>>/)
})

test("a read skeleton checks the call and a canary, a write the declined call and its target, a gws commit its plan, a spending read the decline", () => {
  const read = skeleton(pack("slack"), pack("slack").tools.find((t) => t.class === "read"))
  assert.match(read, /evidence: call:slack\.slack_/)
  assert.match(read, /text:any contains @canary\./)
  assert.match(read, /committed-write:none/)
  assert.match(read, /- Data: seeded/)
  const write = skeleton(pack("slack"), pack("slack").tools.find((t) => t.name === "slack_send_message"))
  assert.match(write, /count:slack\.slack_send_message == 1/)
  assert.match(write, /declined:slack_slack_send_message/)
  assert.match(write, /target:slack\.slack_send_message#1 args\.<<TODO argument>> in @<<TODO alias>>/)
  assert.match(write, /- Data: synthetic/)
  const send = skeleton(pack("gws"), pack("gws").tools.find((t) => t.name === "send"))
  assert.match(send, /gws-plan:#1 op == <<TODO operation id>>/)
  assert.match(send, /declined:gws\.send/)
  const research = skeleton(pack("tavily"), pack("tavily").tools.find((t) => t.name === "tavily_research"))
  assert.match(research, /declined:tavily_tavily_research/)
  assert.match(research, /call:tavily\.tavily_search#1/)
})

test("a filled skeleton compiles against the pack, and its tool names are the pack's", () => {
  const tool = pack("slack").tools.find((t) => t.name === "slack_send_message")
  const text = fill(skeleton(pack("slack"), tool), { "args.<<TODO argument>>": "args.channel_id", "@<<TODO alias>>": "@slack.sandbox_channel" })
  const c = compileCase("cases/slack/tools-slack-send-message.md", text, { packs })
  assert.equal(c.id, "tools-slack-send-message")
  assert.deepEqual(c.sets, ["wide"])
  assert.equal(c.data, "synthetic")
  assert.ok(c.items.length >= 4)
  // every skeleton of every plugin is a compilable case once its placeholders are filled: the packs and the grammar agree
  let compiled = 0
  for (const p of packs) {
    for (const s of skeletons(p)) {
      const filled = fill(s.text, { "args.<<TODO argument>>": "args.id", "@<<TODO alias>>": "@slack.sandbox_channel", "<<TODO operation id>>": "gmail.users.messages.send", "@canary.<<TODO canary name>>": "@canary.example" })
      compileCase(`cases/${p.id}/${s.file}`, filled, { packs })
      compiled++
    }
  }
  assert.ok(compiled > 1000, `${compiled} skeletons compile`)
})
