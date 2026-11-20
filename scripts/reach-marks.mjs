#!/usr/bin/env node
// Builds `packs/<id>/reach.json`: the tools of each pack that can return content that is NOT in a sandbox (the owner's workspace, other people's words, user directories,
// signed URLs, recipients), and the least `Data:` a case that can call one may declare. The pack says which tools exist; this says which of them reach beyond the sandbox.
// A sidecar, not a field of pack.json: `evals pack --sync` rewrites the pack from the plugin's release, and the marks are ours (a test fails when a mark names a tool the
// pack no longer has). Seeded from the case reviewers' lists (cases-pr10 and cases-pr12, F1 and F5) and an audit of every pack's read tools.
//
//   node scripts/reach-marks.mjs           writes packs/<id>/reach.json
//   node scripts/reach-marks.mjs --check   fails when a file differs (CI)
//
// A mark: { floor, why, scope?, unscopable?, lower? }
//   floor        the least `Data:` a case that can call the tool may declare: real (other people's words, Claude only), own (the owner's own data), candidate (HR records)
//   scope        the ONE argument that selects what the tool returns (the channel id, the page id, the agent id): the only argument a `target:` clause may scope the tool by. A tool with no `scope` never
//                lifts, however it is constrained: an argument that does not select what comes back bounds nothing (`limit`, `cursor`, a free-text query).
//   unscopable   no sandbox alias can bound the call (a directory, a notification feed, a workspace-wide search): the floor never lifts
//   lower        { arg, pattern, floor }: the floor is `floor` when every clause of the case that names the tool constrains `args.<arg>` to a value that matches `pattern`
//                (gws read: gmail.* is the owner's real mail, drive.* and calendar.* the owner's own files and events)
// A floor LIFTS only when EVERY call to the tool is constrained, on its `scope` argument, to a sandbox alias: blocker `target:<tool>#n args.<scope> in @<alias>` clauses for calls 1..N and a
// blocker `count:<tool> <= N`. See src/case/reach.mjs for the rule.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")

const M = (floor, why, extra = {}) => ({ floor, why, ...extra })
const real = (why, extra) => M("real", why, extra)
const own = (why, extra) => M("own", why, extra)
const many = (names, mark) => Object.fromEntries(names.map((n) => [n, mark]))

const MARKS = {
  slack: {
    tools: {
      ...many(["slack_search_public", "slack_search_public_and_private"], real("searches every channel of the workspace, other people's messages", { unscopable: true })),
      ...many(["slack_search_channels", "slack_list_user_channels"], real("lists the workspace's channel names and topics", { unscopable: true })),
      ...many(["slack_search_users", "slack_read_user_profile"], real("a user directory: names, titles and addresses of colleagues", { unscopable: true })),
      slack_list_channel_members: real("the members of a channel: colleagues' names"),
      ...many(["slack_read_channel", "slack_read_thread", "slack_get_reactions", "slack_read_file", "slack_read_canvas", "slack_read_list"], real("reads a channel, thread, file, canvas or list by id: any the owner can see, other people's words")),
    },
  },
  linear: {
    tools: {
      ...many(["issues", "get_notifications"], real("the owner's issues and mentions across every team: colleagues' words", { unscopable: true })),
      ...many(["list_users", "list_teams", "get_user", "get_workspace", "get_triage_responsibility"], real("the workspace's people and teams: a directory", { unscopable: true })),
      ...many(
        ["list_issues", "list_documents", "list_initiatives", "list_releases", "list_release_notes", "list_templates", "list_agent_skills", "list_issue_labels", "list_project_labels", "list_initiative_labels", "list_release_pipelines", "list_projects", "list_cycles", "list_milestones", "list_custom_views", "list_issue_statuses", "list_comments", "list_diffs"],
        real("lists the workspace's records when no team or project bounds it: the company's content"),
      ),
      ...many(
        ["get_issue", "get_project", "get_document", "get_initiative", "get_milestone", "get_release", "get_release_note", "get_attachment", "get_diff", "get_diff_threads", "get_agent_skill", "get_template", "get_status_updates", "get_issue_status", "get_team"],
        real("reads a record by id or name: any in the workspace, written by colleagues"),
      ),
    },
  },
  notion: {
    tools: {
      ...many(
        ["notion-search", "notion-ai-search", "notion-connector-search", "notion-memory-search", "notion-list-shared-pages", "notion-list-recent-pages", "notion-list-private-pages", "notion-get-teams", "notion-get-users", "notion-get-groups", "notion-get-sidebar-tabs", "notion-search-agents", "notion-search-sessions", "notion-list-favorite-pages", "notion-query-sessions", "notion-query-meeting-notes"],
        real("searches or lists the whole workspace: other people's pages, teams and people", { unscopable: true }),
      ),
      ...many(["notion-calendar-list-calendar-resources", "notion-calendar-list-calendars", "notion-calendar-list-contacts", "notion-calendar-list-coworkers-events", "notion-calendar-list-events"], real("calendars, contacts and colleagues' events", { unscopable: true })),
      ...many(["notion-fetch", "notion-get-comments", "notion-list-page-backlinks", "notion-get-version-changes", "notion-view-version", "notion-get-suggested-edit", "notion-query-data-sources", "notion-query-multiple-data-sources", "notion-list-session-events", "notion-read-session-event"], real("reads a page, database or session by id or url: any the owner can see, other people's words")),
      ...many(["notion-download-attachment", "notion-get-file-download-urls"], real("a signed URL to a file: a credential for whatever file it names")),
    },
  },
  gws: {
    tools: {
      read: real("gmail.* reads the owner's real mail, drive.* their files, calendar.* their events", { lower: { arg: "operation", pattern: "^(drive|calendar)\\.", floor: "own" } }),
      events_list: own("the owner's calendar events (a source read: gws.events_list, then gws.read on each operation it follows)", { unscopable: true }),
    },
  },
  x: {
    default: real("every read of X returns posts, people and conversations of strangers"),
  },
  elevenlabs: {
    tools: {
      ...many(
        ["agents_get_conversation", "agents_get_conversation_audio_url", "agents_get_conversation_summary", "agents_list_conversations", "agents_count_conversations", "agents_get_summaries", "agents_get_topics", "agents_get_topics_summary", "agents_get_tool_executions", "agents_get_insights_report", "agents_get_latest_bi_report", "agents_get_overview_dashboard", "agents_get_memory", "agents_list_memories", "agents_get_batch_call", "agents_list_batch_calls", "agents_get_alert", "agents_list_alerts", "agents_get_triage_ticket", "agents_list_triage_tickets", "agents_get_triage_ticket_assignable_users", "agents_get_test_result", "agents_get_test_run", "agents_get_test_run_failures"],
        real("what callers said to the owner's agents, and who they were: other people's words and personal data"),
      ),
      ...many(["agents_get_phone_number", "agents_list_phone_numbers", "agents_get_whatsapp_account", "agents_list_webhooks", "agents_list_secrets", "agents_get_link", "creative_get_available_assets", "creative_get_generations", "creative_list_voices"], real("phone numbers, webhooks, secrets, signed links or voices of the owner's account")),
      // Round-4 relabels and the conversation reads the case reviews flagged (review of #14, R1): searches of what callers said, analytics over it, a signed URL into a live conversation, a transcription
      ...many(["agents_search_conversation_messages", "agents_semantic_search_conversation_messages", "agents_resolve_conversation", "agents_list_whatsapp_accounts"], real("what callers said, found by search or by reference, and the WhatsApp accounts: other people's words and personal data")),
      ...many(["agents_query_workspace_conversations", "agents_query_analytics"], real("analytics and queries over every conversation of the workspace: what callers said and who they were", { unscopable: true })),
      agents_get_signed_url: real("a signed URL into a live conversation with the owner's agent: a credential for whatever the agent can do", { unscopable: true }),
      creative_transcribe_audio: real("sends an audio file to ElevenLabs and returns what is said in it: any file the owner can reach", { unscopable: true }),
    },
  },
  boxd: {
    tools: {
      read: own("reads a file on a machine of the owner's: their own infrastructure"),
      job: own("a job's output on a machine of the owner's"),
    },
  },
  jobs: {
    tools: many(["list", "get", "history"], own("the owner's own scheduled jobs and their runs")),
  },
  browse: {
    tools: many(["secrets_list", "session_list"], own("the names of the owner's stored secrets and the pages their browser has open")),
  },
}

/**
 * The ONE argument that selects what each marked tool returns, by plugin. A tool not listed has no scope and its floor never lifts. Only an argument that names the thing read counts (a channel,
 * a page, a record by id, a team or an agent whose records are listed): not a free-text query, a limit or a cursor, and not a tool that has several selectors of which a call may pass any.
 */
const SCOPES = {
  slack: { slack_get_reactions: "channel_id", slack_list_channel_members: "channel_id", slack_read_canvas: "canvas_id", slack_read_channel: "channel_id", slack_read_file: "file_id", slack_read_list: "list_id", slack_read_thread: "channel_id" },
  linear: {
    get_agent_skill: "id", get_attachment: "id", get_diff: "urlOrId", get_diff_threads: "urlOrId", get_document: "id", get_issue: "id", get_release: "id", get_release_note: "id", get_template: "id",
    get_milestone: "project", list_milestones: "project", list_cycles: "teamId", list_issue_statuses: "team", list_templates: "team", list_issues: "team", list_projects: "team", list_issue_labels: "team",
    list_project_labels: "team", list_custom_views: "team", list_release_pipelines: "team",
  },
  notion: { "notion-fetch": "id", "notion-get-comments": "page_id", "notion-list-page-backlinks": "page_id", "notion-get-version-changes": "page", "notion-view-version": "page" },
  elevenlabs: {
    agents_count_conversations: "agent_id", agents_get_insights_report: "agent_id", agents_get_latest_bi_report: "agent_id", agents_get_link: "agent_id", agents_get_memory: "agent_id", agents_get_overview_dashboard: "agent_id",
    agents_get_topics: "agent_id", agents_get_topics_summary: "agent_id", agents_get_triage_ticket_assignable_users: "agent_id", agents_list_alerts: "agent_id", agents_list_batch_calls: "agent_id",
    agents_list_conversations: "agent_id", agents_list_memories: "agent_id", agents_list_triage_tickets: "agent_id", agents_search_conversation_messages: "agent_id",
    agents_semantic_search_conversation_messages: "agent_id", agents_resolve_conversation: "agent_id", agents_list_whatsapp_accounts: "agent_id",
    agents_get_conversation: "conversation_id", agents_get_conversation_audio_url: "conversation_id", agents_get_conversation_summary: "conversation_id", agents_get_batch_call: "batch_id", agents_get_alert: "alert_id",
    agents_get_phone_number: "phone_number_id", agents_get_whatsapp_account: "phone_number_id", agents_get_test_result: "test_run_id", agents_get_test_run: "test_invocation_id",
    agents_get_test_run_failures: "test_invocation_id", agents_get_triage_ticket: "agentqa_ticket_id",
  },
  boxd: { job: "workId", read: "workId" },
  jobs: { get: "id", history: "id" },
}

/** Every tool of the pack that has no mark of its own gets the plugin's `default`, if it has one (reads only: a write is graded at its declined call). */
function build(id, spec, pack) {
  const tools = { ...(spec.tools ?? {}) }
  if (spec.default) for (const tool of pack.tools) if (tool.class === "read" && !tool.hidden && !(tool.name in tools) && tool.name !== "events_list") tools[tool.name] = { ...spec.default }
  // The scope argument of each marked tool: it must be a parameter the tool takes (packs/<id>/inputs.json), and a tool marked `unscopable` has none.
  const inputsFile = join(ROOT, "packs", id, "inputs.json")
  const inputs = existsSync(inputsFile) ? JSON.parse(readFileSync(inputsFile, "utf8")).tools : {}
  for (const [name, arg] of Object.entries(SCOPES[id] ?? {})) {
    if (!(name in tools)) throw new Error(`${id}: ${name} has a scope (${arg}) but no mark`)
    if (tools[name].unscopable) throw new Error(`${id}: ${name} is unscopable and cannot have a scope`)
    if (!Object.hasOwn(inputs[name]?.p ?? {}, arg)) throw new Error(`${id}: ${name} has no parameter ${arg} (its parameters: ${Object.keys(inputs[name]?.p ?? {}).join(", ")})`)
    tools[name] = { ...tools[name], scope: arg }
  }
  const names = new Set(pack.tools.map((t) => t.name))
  const missing = Object.keys(tools).filter((name) => !names.has(name))
  if (missing.length) throw new Error(`${id}: marks name tools the pack does not have: ${missing.join(", ")}`)
  return { schema: "oc-reach/1", plugin: id, note: "Tools that can return content that is not in a sandbox, and the least `Data:` a case that can call one may declare. Built by scripts/reach-marks.mjs; see src/case/reach.mjs for how a case's floor is worked out.", tools: Object.fromEntries(Object.entries(tools).sort(([a], [b]) => a.localeCompare(b))) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check")
  let bad = 0
  for (const [id, spec] of Object.entries(MARKS)) {
    const pack = JSON.parse(readFileSync(join(ROOT, "packs", id, "pack.json"), "utf8"))
    const text = `${JSON.stringify(build(id, spec, pack), null, 1)}\n`
    const file = join(ROOT, "packs", id, "reach.json")
    if (check) {
      if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
        console.error(`${file} is not what scripts/reach-marks.mjs builds`)
        bad++
      }
    } else {
      writeFileSync(file, text)
      console.log(`${id}: ${Object.keys(JSON.parse(text).tools).length} tool(s) marked`)
    }
  }
  if (bad) process.exit(1)
}
export { MARKS, build }
