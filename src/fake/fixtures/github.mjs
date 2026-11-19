// A fake GitHub: one invented organisation, one repository, a few issues, pull requests, commits and branches. Every name here is made up
// (the `.invalid` host never resolves). `facts` are what a read case grades an answer against: an answer that does not state them was not
// read from this fixture. `call` answers GitHub's MCP tools; a tool with no handler answers that nothing matches, and a write answers that
// nothing was changed (a write that runs at all is a failure of the harness's ask, and the guard halts the wave on it).

const HOST = "https://github.invalid"
export const OWNER = "fabrikam-labs"
export const REPO = "quill-notes"
const full = `${OWNER}/${REPO}`
const user = (login) => ({ login, id: login.length * 1111, html_url: `${HOST}/${login}`, type: "User" })
const people = { ada: user("ada-lantern"), bo: user("bo-marlowe"), cy: user("cy-whitlock") }

const labels = { bug: { name: "bug", color: "d73a4a" }, sync: { name: "sync", color: "0e8a16" }, docs: { name: "documentation", color: "0075ca" }, good: { name: "good first issue", color: "7057ff" } }

export const issues = [
  { number: 1, title: "Notes vanish after a failed sync", state: "open", labels: [labels.bug, labels.sync], assignee: people.ada, user: people.bo, comments: 2, created_at: "2026-09-02T09:14:00Z", body: "After a failed sync over a bad connection the note list comes back empty until the app restarts." },
  { number: 2, title: "Dark mode flickers on the settings page", state: "open", labels: [labels.bug], assignee: people.bo, user: people.cy, comments: 0, created_at: "2026-09-05T13:40:00Z", body: "Opening settings in dark mode flashes white for one frame." },
  { number: 3, title: "Document the export formats", state: "open", labels: [labels.docs, labels.good], assignee: null, user: people.ada, comments: 1, created_at: "2026-09-11T08:02:00Z", body: "The README lists Markdown export only; PDF and plain text exist too." },
  { number: 4, title: "Search ignores accented letters", state: "closed", labels: [labels.bug], assignee: people.cy, user: people.bo, comments: 3, created_at: "2026-08-21T16:25:00Z", closed_at: "2026-09-01T10:00:00Z", body: "Searching for cafe does not find café." },
  { number: 5, title: "Add an offline banner", state: "open", labels: [labels.sync], assignee: people.ada, user: people.ada, comments: 4, created_at: "2026-09-14T11:30:00Z", body: "Show a banner when the device has no connection." },
  { number: 6, title: "Rename the default notebook", state: "closed", labels: [], assignee: people.bo, user: people.cy, comments: 1, created_at: "2026-08-30T07:45:00Z", closed_at: "2026-09-03T12:00:00Z", body: "The default notebook is called Untitled; call it Inbox." },
]
export const pulls = [
  { number: 7, title: "Add offline queue for note sync", state: "open", draft: false, head: "feature/offline-queue", base: "main", user: people.ada, comments: 2, additions: 212, deletions: 18, changed_files: 6, created_at: "2026-09-15T09:00:00Z", body: "Queues edits while offline and replays them in order. Closes #1." },
  { number: 8, title: "Fix dark mode flash on settings", state: "open", draft: true, head: "fix/dark-flash", base: "main", user: people.bo, comments: 0, additions: 14, deletions: 3, changed_files: 2, created_at: "2026-09-16T14:10:00Z", body: "Sets the background before first paint. Closes #2." },
  { number: 9, title: "Normalise accents in search", state: "merged", draft: false, head: "fix/accent-search", base: "main", user: people.cy, comments: 5, additions: 61, deletions: 9, changed_files: 3, created_at: "2026-08-28T10:20:00Z", merged_at: "2026-09-01T09:55:00Z", body: "Folds accents before matching. Closes #4." },
]
export const commits = [
  { sha: "c0ffee1aa11", message: "Normalise accents in search (#9)", author: people.cy, date: "2026-09-01T09:55:00Z" },
  { sha: "b16b00b2bb2", message: "Rename the default notebook to Inbox", author: people.bo, date: "2026-09-03T12:00:00Z" },
  { sha: "a11ce5c3cc3", message: "Bump the sync timeout to 30 seconds", author: people.ada, date: "2026-09-08T08:15:00Z" },
]
export const branches = [{ name: "main", protected: true }, { name: "feature/offline-queue", protected: false }, { name: "fix/dark-flash", protected: false }]
export const files = { "README.md": "# Quill Notes\n\nA small notebook app that syncs notes between devices.\n\nExport: Markdown.\n", "docs/sync.md": "# Sync\n\nEdits are sent every 30 seconds.\n" }
export const release = { tag_name: "v0.3.0", name: "Quill Notes 0.3.0", published_at: "2026-09-09T10:00:00Z", body: "Adds notebook sharing." }

const open = (list) => list.filter((x) => x.state === "open")

/** What an answer must state to have been read from this fixture. */
export const facts = {
  owner: OWNER,
  repo: REPO,
  me: people.ada.login,
  open_issue_count: String(open(issues).length),
  closed_issue_count: String(issues.filter((i) => i.state === "closed").length),
  open_issue_titles: open(issues).map((i) => i.title),
  bug_issue_title: issues[0].title,
  assigned_to_ada: issues.filter((i) => i.assignee?.login === people.ada.login && i.state === "open").map((i) => i.title),
  open_pr_numbers: open(pulls).map((p) => String(p.number)),
  offline_pr_title: pulls[0].title,
  merged_pr_title: pulls[2].title,
  latest_commit_message: commits[0].message,
  branches: branches.map((b) => b.name),
  latest_release: release.tag_name,
  readme_title: "Quill Notes",
}

const text = (value) => ({ text: typeof value === "string" ? value : JSON.stringify(value, null, 1) })
const issueOut = (i) => ({ number: i.number, title: i.title, state: i.state, labels: i.labels.map((l) => l.name), assignee: i.assignee?.login ?? null, user: i.user.login, comments: i.comments, created_at: i.created_at, html_url: `${HOST}/${full}/issues/${i.number}`, body: i.body })
const pullOut = (p) => ({ number: p.number, title: p.title, state: p.state, draft: p.draft, head: p.head, base: p.base, user: p.user.login, comments: p.comments, additions: p.additions, deletions: p.deletions, changed_files: p.changed_files, merged: p.state === "merged", created_at: p.created_at, html_url: `${HOST}/${full}/pull/${p.number}`, body: p.body })
const inRepo = (args) => (!args.owner || args.owner === OWNER) && (!args.repo || args.repo === REPO)
const wrongRepo = (args) => ({ text: `Not Found: ${args.owner ?? "?"}/${args.repo ?? "?"} does not exist in this fixture (the only repository is ${full}).`, isError: true })
const byState = (list, state) => (!state || state === "all" ? list : list.filter((x) => x.state === state || (state === "closed" && x.state === "merged")))
const match = (item, query) => {
  const q = String(query ?? "").toLowerCase()
  const words = q.split(/\s+/).filter((w) => w && !/^(repo|is|state|type|label|author|assignee|org|user|in):/.test(w))
  if (/\bis:open\b|\bstate:open\b/.test(q) && item.state !== "open") return false
  if (/\bis:closed\b|\bstate:closed\b/.test(q) && item.state === "open") return false
  const lab = /label:"?([^"\s]+)"?/.exec(q)
  if (lab && !(item.labels ?? []).some((l) => (l.name ?? l).toLowerCase() === lab[1])) return false
  const asg = /assignee:(\S+)/.exec(q)
  if (asg && item.assignee?.login !== asg[1] && !(asg[1] === "@me" && item.assignee?.login === people.ada.login)) return false
  return words.every((w) => `${item.title} ${item.body}`.toLowerCase().includes(w))
}

const HANDLERS = {
  get_me: () => text({ login: people.ada.login, name: "Ada Lantern", html_url: `${HOST}/${people.ada.login}` }),
  search_repositories: () => text({ total_count: 1, items: [{ full_name: full, description: "A small notebook app that syncs notes between devices.", default_branch: "main", open_issues_count: open(issues).length, html_url: `${HOST}/${full}` }] }),
  list_issues: (a) => (inRepo(a) ? text(byState(issues, String(a.state ?? "open").toLowerCase()).map(issueOut)) : wrongRepo(a)),
  issue_read: (a) => {
    if (!inRepo(a)) return wrongRepo(a)
    const issue = issues.find((i) => i.number === Number(a.issue_number))
    if (!issue) return { text: `Not Found: issue #${a.issue_number}`, isError: true }
    const method = String(a.method ?? "get")
    if (method === "get_comments") return text([{ user: people.bo.login, body: "I can reproduce this on the latest build.", created_at: "2026-09-03T10:00:00Z" }].slice(0, issue.comments))
    if (method === "get_labels") return text(issue.labels)
    return text(issueOut(issue))
  },
  search_issues: (a) => text({ total_count: issues.filter((i) => match(i, a.query)).length, items: issues.filter((i) => match(i, a.query)).map(issueOut) }),
  list_pull_requests: (a) => (inRepo(a) ? text(byState(pulls, String(a.state ?? "open").toLowerCase()).map(pullOut)) : wrongRepo(a)),
  pull_request_read: (a) => {
    if (!inRepo(a)) return wrongRepo(a)
    const pr = pulls.find((p) => p.number === Number(a.pullNumber ?? a.pull_number))
    if (!pr) return { text: `Not Found: pull request #${a.pullNumber ?? a.pull_number}`, isError: true }
    const method = String(a.method ?? "get")
    if (method === "get_files") return text([{ filename: "src/sync/queue.ts", status: "added", additions: pr.additions, deletions: 0 }])
    if (method === "get_status") return text({ state: "success", total_count: 1, statuses: [{ context: "ci/build", state: "success" }] })
    if (method === "get_comments" || method === "get_review_comments" || method === "get_reviews") return text([])
    if (method === "get_diff") return text(`diff --git a/src/sync/queue.ts b/src/sync/queue.ts\n+export const queue = []\n`)
    return text(pullOut(pr))
  },
  search_pull_requests: (a) => text({ total_count: pulls.filter((p) => match(p, a.query)).length, items: pulls.filter((p) => match(p, a.query)).map(pullOut) }),
  list_commits: (a) => (inRepo(a) ? text(commits.map((c) => ({ sha: c.sha, message: c.message, author: c.author.login, date: c.date }))) : wrongRepo(a)),
  get_commit: (a) => {
    const c = commits.find((x) => x.sha.startsWith(String(a.sha ?? "")) || a.sha === "main")
    return c ? text({ sha: c.sha, message: c.message, author: c.author.login, date: c.date, files: [] }) : { text: `Not Found: commit ${a.sha}`, isError: true }
  },
  list_branches: (a) => (inRepo(a) ? text(branches) : wrongRepo(a)),
  get_file_contents: (a) => {
    if (!inRepo(a)) return wrongRepo(a)
    const path = String(a.path ?? "/").replace(/^\//, "")
    if (path === "" || path === "/") return text(Object.keys(files).map((p) => ({ path: p, type: p.includes("/") ? "dir" : "file" })))
    return files[path] !== undefined ? text(files[path]) : { text: `Not Found: ${path}`, isError: true }
  },
  get_repository_tree: (a) => (inRepo(a) ? text(Object.keys(files).map((path) => ({ path, type: "blob" }))) : wrongRepo(a)),
  list_releases: (a) => (inRepo(a) ? text([release]) : wrongRepo(a)),
  get_latest_release: (a) => (inRepo(a) ? text(release) : wrongRepo(a)),
  list_tags: (a) => (inRepo(a) ? text([{ name: release.tag_name }]) : wrongRepo(a)),
  list_label: (a) => (inRepo(a) ? text(Object.values(labels)) : wrongRepo(a)),
  get_label: (a) => (labels[Object.keys(labels).find((k) => labels[k].name === a.name)] ? text(Object.values(labels).find((l) => l.name === a.name)) : { text: `Not Found: label ${a.name}`, isError: true }),
  list_notifications: () => text([]),
  search_code: (a) => text({ total_count: 1, items: Object.keys(files).filter((p) => files[p].toLowerCase().includes(String(a.query ?? "").toLowerCase().split(/\s+/)[0])).map((path) => ({ path, repository: full })) }),
}

const WRITE = /^(create|add|update|delete|merge|close|reopen|assign|request|submit|dismiss|push|fork|star|unstar|mark|set|sub_issue|issue_write|pull_request_review_write|actions_run_trigger|dismiss|projects_write|label_write|gist|manage|edit|lock|transfer|enable|disable|run)/

export function call(name, args = {}) {
  if (HANDLERS[name]) return HANDLERS[name](args)
  if (WRITE.test(name) || /_write$/.test(name)) return { text: "Nothing was changed: this is a fixture." }
  return text({ message: "Nothing in this fixture matches.", results: [] })
}
