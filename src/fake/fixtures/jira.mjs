// A fake Jira: one invented site, one project (QLN, Quill Notes), a handful of issues. Every name here is made up (the `.invalid` host never
// resolves). `facts` are what a read case grades an answer against. `call` answers Atlassian's MCP tools; a tool with no handler answers
// that nothing matches, and a write answers that nothing was changed (a write that runs at all is a failure of the harness's ask).

import { parseWhen } from "./when.mjs"

export const CLOUD_ID = "5b0c1d2e-7a41-4c3a-9f10-2d4e6a8b0c12"
export const SITE = "quill-labs.invalid"
const user = (name, id) => ({ accountId: id, displayName: name, emailAddress: `${name.toLowerCase().replace(/\W+/g, ".")}@example.org`, active: true })
const ada = user("Ada Lantern", "acct-ada-0001")
const bo = user("Bo Marlowe", "acct-bo-0002")
const cy = user("Cy Whitlock", "acct-cy-0003")

export const project = { id: "10001", key: "QLN", name: "Quill Notes", projectTypeKey: "software", lead: ada.displayName }
export const statuses = [{ name: "To Do", category: "To Do" }, { name: "In Progress", category: "In Progress" }, { name: "In Review", category: "In Progress" }, { name: "Done", category: "Done" }]
export const issues = [
  { key: "QLN-1", summary: "Notes vanish after a failed sync", type: "Bug", status: "In Progress", priority: "Highest", assignee: ada, reporter: bo, labels: ["sync"], sprint: "Sprint 12", created: "2026-09-02T09:14:00Z", updated: "2026-09-12T09:00:00Z", description: "After a failed sync the note list comes back empty until the app restarts.", comments: ["Reproduced on the latest build."] },
  { key: "QLN-2", summary: "Dark mode flickers on the settings page", type: "Bug", status: "To Do", priority: "Medium", assignee: bo, reporter: cy, labels: ["ui"], sprint: "Sprint 12", created: "2026-09-05T13:40:00Z", updated: "2026-09-05T13:40:00Z", description: "Settings flashes white for one frame in dark mode.", comments: [] },
  { key: "QLN-3", summary: "Document the export formats", type: "Task", status: "To Do", priority: "Low", assignee: null, reporter: ada, labels: ["docs"], sprint: null, created: "2026-09-11T08:02:00Z", updated: "2026-09-11T08:02:00Z", description: "The README lists Markdown only; PDF and plain text exist too.", comments: [] },
  { key: "QLN-4", summary: "Search ignores accented letters", type: "Bug", status: "Done", priority: "High", assignee: cy, reporter: bo, labels: ["search"], sprint: "Sprint 11", created: "2026-08-21T16:25:00Z", updated: "2026-09-01T10:00:00Z", resolved: "2026-09-01T10:00:00Z", resolution: "Done", description: "Searching for cafe does not find café.", comments: ["Fixed in the accents change.", "Verified."] },
  { key: "QLN-5", summary: "Add an offline banner", type: "Story", status: "In Progress", priority: "Medium", assignee: ada, reporter: ada, labels: ["sync", "ui"], sprint: "Sprint 12", created: "2026-09-14T11:30:00Z", updated: "2026-09-16T08:30:00Z", description: "Show a banner when the device has no connection.", comments: ["Design attached."] },
  { key: "QLN-6", summary: "Rename the default notebook", type: "Task", status: "Done", priority: "Low", assignee: bo, reporter: cy, labels: [], sprint: "Sprint 11", created: "2026-08-30T07:45:00Z", updated: "2026-09-14T15:00:00Z", resolved: "2026-09-14T15:00:00Z", resolution: "Done", description: "Call the default notebook Inbox.", comments: [] },
  { key: "QLN-7", summary: "Sync queue needs a retry limit", type: "Story", status: "In Review", priority: "High", assignee: cy, reporter: ada, labels: ["sync"], sprint: "Sprint 12", created: "2026-09-16T10:05:00Z", updated: "2026-09-16T10:05:00Z", description: "Stop retrying a failed upload after five attempts.", comments: [] },
]
export const boards = [{ id: 7, name: "Quill Notes board", type: "scrum" }]
export const sprints = [{ id: 12, name: "Sprint 12", state: "active" }, { id: 11, name: "Sprint 11", state: "closed" }]
export const versions = [{ id: "20001", name: "0.3.0", released: true }, { id: "20002", name: "0.4.0", released: false }]

const inProgress = issues.filter((i) => i.status === "In Progress")
const day = (iso) => iso.slice(0, 10)
const createdBetween = (from, to) => issues.filter((i) => day(i.created) >= from && day(i.created) <= to).map((i) => i.key)
/** What an answer must state to have been read from this fixture. */
export const facts = {
  site: SITE,
  project_key: project.key,
  project_name: project.name,
  me: ada.displayName,
  issue_count: String(issues.length),
  in_progress_count: String(inProgress.length),
  in_progress_keys: inProgress.map((i) => i.key),
  highest_priority_key: issues.find((i) => i.priority === "Highest").key,
  highest_priority_summary: issues.find((i) => i.priority === "Highest").summary,
  unassigned_key: issues.find((i) => !i.assignee).key,
  assigned_to_ada_keys: issues.filter((i) => i.assignee?.accountId === ada.accountId).map((i) => i.key),
  done_keys: issues.filter((i) => i.status === "Done").map((i) => i.key),
  created_sept_1_to_10_keys: createdBetween("2026-09-01", "2026-09-10"),
  created_sept_11_on_keys: createdBetween("2026-09-11", "2026-12-31"),
  created_before_sept_1_keys: createdBetween("2000-01-01", "2026-08-31"),
  updated_sept_16_keys: issues.filter((i) => day(i.updated) === "2026-09-16").map((i) => i.key),
  resolved_last_7_days_keys: issues.filter((i) => i.resolved && Date.parse(i.resolved) >= Date.UTC(2026, 8, 10, 12) && Date.parse(i.resolved) <= Date.UTC(2026, 8, 17, 12)).map((i) => i.key),
  resolved_before_sept_10_keys: issues.filter((i) => i.resolved && day(i.resolved) < "2026-09-10").map((i) => i.key),
  resolved_this_week_keys: issues.filter((i) => i.resolved && day(i.resolved) >= "2026-09-14" && day(i.resolved) <= "2026-09-20").map((i) => i.key),
  unresolved_count: String(issues.filter((i) => !i.resolved).length),
  active_sprint: "Sprint 12",
  unreleased_version: "0.4.0",
}

const text = (value) => ({ text: typeof value === "string" ? value : JSON.stringify(value, null, 1) })
const out = (i) => ({ key: i.key, id: String(10000 + Number(i.key.split("-")[1])), summary: i.summary, issuetype: i.type, status: i.status, priority: i.priority, assignee: i.assignee?.displayName ?? null, reporter: i.reporter.displayName, labels: i.labels, sprint: i.sprint, created: i.created, updated: i.updated, resolved: i.resolved ?? null, resolution: i.resolution ?? null, url: `https://${SITE}/browse/${i.key}` })
const full = (i) => ({ ...out(i), description: i.description, comment_count: i.comments.length })
const fieldValue = (i, field) => {
  switch (field.toLowerCase()) {
    case "project":
      return project.key
    case "status":
      return i.status
    case "resolution":
      return i.resolution ?? ""
    case "statuscategory":
      return statuses.find((s) => s.name === i.status).category
    case "assignee":
      return i.assignee?.displayName ?? ""
    case "reporter":
      return i.reporter.displayName
    case "issuetype":
    case "type":
      return i.type
    case "priority":
      return i.priority
    case "key":
    case "issuekey":
      return i.key
    case "labels":
      return i.labels
    case "sprint":
      return i.sprint ?? ""
    case "summary":
    case "text":
      return `${i.summary} ${i.description}`
    default:
      return undefined
  }
}
const unq = (v) => v.trim().replace(/^["']|["']$/g, "")

// `resolutiondate` is `resolved` (Jira documents both names). An issue with no resolution has no date: it matches no comparison, and `is EMPTY` / `is NULL`.
const DATE_FIELDS = new Map([["created", "created"], ["updated", "updated"], ["resolved", "resolved"], ["resolutiondate", "resolved"]])
const OPS = { ">=": (v, w) => v >= w.start, ">": (v, w) => v > w.start, "<=": (v, w) => v <= w.start, "<": (v, w) => v < w.start }

/**
 * A date clause the way Jira reads it: a bare date is that day's midnight (`created <= "2026-09-10"` stops at 00:00 on the 10th; `created = 2026-09-10`
 * is the whole day), `-7d`, `-2w`, `now()` count back from the fake's fixed now. Returns a filter, or an error text.
 */
function dateFilter(field, op, valueRaw) {
  if (op === "is") {
    if (/^(empty|null)$/i.test(valueRaw.trim())) return { test: (i) => !i[field] }
    if (/^not\s+(empty|null)$/i.test(valueRaw.trim())) return { test: (i) => Boolean(i[field]) }
    return { error: `The fake does not understand ${field} is ${valueRaw} (use is EMPTY, is NULL, is not EMPTY or is not NULL)` }
  }
  const when = parseWhen(valueRaw)
  if (!when) return { error: `The fake does not understand the JQL date: ${valueRaw} (use "YYYY-MM-DD", "YYYY-MM-DD HH:mm", -7d, -2w or now())` }
  if (op in OPS) return { test: (i) => OPS[op](Date.parse(i[field]), when) }
  if (op === "=" || op === "!=") {
    const inside = (i) => Date.parse(i[field]) >= when.start && Date.parse(i[field]) <= when.end
    return { test: op === "=" ? inside : (i) => !inside(i) }
  }
  return { error: `The fake does not understand ${field} ${op}: a date is compared with =, !=, >, >=, < or <=` }
}

/** The part of JQL the fake understands: clauses joined by AND, each `field = | != | ~ | in (...) value`, or `created | updated >= | > | <= | < | = date`; ORDER BY is ignored. */
/** `text` split at the unquoted, unparenthesised word `AND` or `OR` (any case): `summary ~ "a and b" AND status in (x, y)` is two clauses. */
export function splitTop(text, word) {
  const parts = []
  let depth = 0
  let quote = null
  let from = 0
  const re = new RegExp(`^\\s+${word}\\s+`, "i")
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote && text[i - 1] !== "\\") quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === "(") depth++
    else if (c === ")") depth--
    else if (depth === 0 && /\s/.test(c)) {
      const m = re.exec(text.slice(i))
      if (m) {
        parts.push(text.slice(from, i))
        i += m[0].length - 1
        from = i + 1
      }
    }
  }
  parts.push(text.slice(from))
  return parts
}

/**
 * JQL as the fake reads it: groups joined by OR, each group clauses joined by AND (AND binds tighter, as in Jira); the answer is every issue any group returns, in the fixture's order.
 * Parentheses around a group and NOT are refused with an error, never an empty list.
 */
export function runJql(jql) {
  const where = String(jql ?? "").replace(/\border\s+by\b.*$/i, "").trim()
  if (!where) return { issues }
  if (/(^|\s)(and|or)\s*$/i.test(where) || /^\s*(and|or)\s/i.test(where)) return { error: `The fake does not understand the JQL: AND or OR with nothing on one side: ${where}` }
  const groups = splitTop(where, "or")
  if (groups.length === 1) return runAnd(where)
  const found = new Set()
  for (const group of groups) {
    const r = runAnd(group.trim())
    if (r.error) return r
    for (const issue of r.issues) found.add(issue)
  }
  return { issues: issues.filter((i) => found.has(i)) }
}

function runAnd(where) {
  let list = issues
  for (const raw of splitTop(where, "and")) {
    const m = /^(\w+)\s*(>=|<=|!=|=|>|<|~|\bnot in\b|\bin\b|\bis\b)\s*(.+)$/i.exec(raw.trim())
    if (!m) return { error: `The fake does not understand the JQL clause: ${raw}` }
    const [, field, opRaw, valueRaw] = m
    const op = opRaw.toLowerCase()
    let values = /^\(.*\)$/.test(valueRaw.trim()) ? valueRaw.trim().slice(1, -1).split(",").map(unq) : [unq(valueRaw)]
    values = values.map((v) => (/^currentuser\(\)$/i.test(v) ? ada.displayName : v))
    if (DATE_FIELDS.has(field.toLowerCase())) {
      const filter = dateFilter(DATE_FIELDS.get(field.toLowerCase()), op, valueRaw)
      if (filter.error) return { error: filter.error }
      list = list.filter(filter.test)
      continue
    }
    if (op in OPS) return { error: `The fake does not understand ${field} ${op}: only created, updated and resolved compare with ${op}` }
    if (fieldValue(issues[0], field) === undefined) return { error: `The fake does not know the JQL field: ${field}` }
    list = list.filter((i) => {
      const actual = fieldValue(i, field)
      const hay = (Array.isArray(actual) ? actual : [actual]).map((x) => String(x).toLowerCase())
      // Jira's special value: resolution = Unresolved is "no resolution".
      const wanted = values.map((v) => (field.toLowerCase() === "resolution" && /^unresolved$/i.test(v) ? "" : v.toLowerCase()))
      if (op === "~") return wanted.some((w) => hay.some((h) => h.includes(w)))
      if (op === "is") return /^(empty|null)$/.test(wanted[0]) ? hay.every((h) => h === "") : /^not\s+(empty|null)$/.test(wanted[0]) ? hay.some((h) => h !== "") : false
      const hit = wanted.some((w) => hay.includes(w))
      return op === "!=" || op === "not in" ? !hit : hit
    })
  }
  return { issues: list }
}

const issueByKey = (a) => issues.find((i) => i.key.toLowerCase() === String(a.issueIdOrKey ?? a.issueKey ?? "").toLowerCase())
const notFound = (a) => ({ text: `Issue ${a.issueIdOrKey ?? ""} does not exist or you do not have permission to see it (this fixture holds ${project.key}-1 to ${issues.at(-1).key}).`, isError: true })

const HANDLERS = {
  getAccessibleAtlassianResources: () => text([{ id: CLOUD_ID, url: `https://${SITE}`, name: "Quill Labs", scopes: ["read:jira-work"] }]),
  atlassianUserInfo: () => text({ account_id: ada.accountId, name: ada.displayName, email: ada.emailAddress }),
  getJiraCurrentUser: () => text(ada),
  getJiraUser: () => text(ada),
  lookupJiraAccountId: (a) => text([ada, bo, cy].filter((u) => u.displayName.toLowerCase().includes(String(a.searchString ?? a.query ?? "").toLowerCase()))),
  listJiraProjects: () => text({ total: 1, values: [project] }),
  getJiraIssue: (a) => (issueByKey(a) ? text(full(issueByKey(a))) : notFound(a)),
  searchJiraIssuesUsingJql: (a) => {
    const r = runJql(a.jql)
    if (r.error) return { text: r.error, isError: true }
    return String(a.searchResultMode ?? "issues") === "count" ? text({ count: r.issues.length }) : text({ total: r.issues.length, issues: r.issues.map(out) })
  },
  listJiraIssueComments: (a) => (issueByKey(a) ? text({ total: issueByKey(a).comments.length, comments: issueByKey(a).comments.map((body, n) => ({ id: String(n + 1), author: bo.displayName, body })) }) : notFound(a)),
  listJiraIssueTransitions: (a) => (issueByKey(a) ? text({ transitions: [{ id: "11", name: "Start progress", to: "In Progress" }, { id: "21", name: "Send for review", to: "In Review" }, { id: "31", name: "Done", to: "Done" }] }) : notFound(a)),
  listJiraIssueWorklogs: (a) => (issueByKey(a) ? text({ total: 0, worklogs: [] }) : notFound(a)),
  listJiraIssueChangelogs: (a) => (issueByKey(a) ? text({ values: [] }) : notFound(a)),
  listJiraProjectIssueTypesMetadata: () => text([{ id: "1", name: "Bug" }, { id: "2", name: "Task" }, { id: "3", name: "Story" }]),
  listJiraStatuses: () => text(statuses),
  listJiraIssueLinkTypes: () => text([{ id: "1", name: "Blocks", inward: "is blocked by", outward: "blocks" }]),
  listJiraBoards: () => text({ values: boards }),
  listJiraBoardSprints: () => text({ values: sprints }),
  getJiraBoardIssueData: () => text({ issues: issues.filter((i) => i.sprint === "Sprint 12").map(out) }),
  getJiraBoardSprintData: () => text({ sprint: sprints[0], issues: issues.filter((i) => i.sprint === "Sprint 12").map(out) }),
  getJiraProjectVersions: () => text({ values: versions }),
  listJiraProjectComponents: () => text([{ name: "sync" }, { name: "ui" }]),
  listJiraFilters: () => text({ values: [{ id: "1", name: "My open issues", jql: "assignee = currentUser() AND statusCategory != Done" }] }),
  listJiraDashboards: () => text({ dashboards: [] }),
  listJiraIssueAssignableUsers: () => text([ada, bo, cy]),
}

const WRITE = /^(create|add|edit|delete|update|transition|manage|convert|upload|watch|download)/i

export function call(name, args = {}) {
  if (HANDLERS[name]) return HANDLERS[name](args)
  if (WRITE.test(name)) return { text: "Nothing was changed: this is a fixture." }
  return text({ message: "Nothing in this fixture matches." })
}
