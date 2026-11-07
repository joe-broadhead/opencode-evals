// T-G: gold cases with known verdicts, over synthetic traces. They test the graders, not the plugin.
//
// A suite whose checks are weak passes everything; these are the cases that must fail, must block, must
// be N/A and must be untouched by an advisory item — so a change to the grader that makes it more lenient
// shows up here first.

const run = (overrides = {}) => ({
  schema: "oc-trace/1",
  run_id: "gold/0",
  case: "gold",
  trial: 1,
  arm: "with-skill",
  started_at: "2026-11-07T00:00:00Z",
  ended_at: "2026-11-07T00:00:01Z",
  duration_ms: 1000,
  exit: 0,
  failure_class: null,
  model: { id: "gold", params: {} },
  summary: {
    outer_calls: 2,
    inner_calls: 1,
    steps: 2,
    skills_loaded: ["x"],
    tokens: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 },
    cost: { amount_usd: null, source: "missing" },
    text: { sha256: "0".repeat(64), chars: 10, lines: 1 },
  },
  ...overrides,
})

const call = (seq, tool, args = {}, extra = {}) => ({
  seq,
  ts_ms: 0,
  kind: "tool_call",
  tool,
  via: extra.via ?? "execute",
  args,
  args_parsed: true,
  ...(extra.ns ? { ns: extra.ns } : {}),
})

const result = (seq, tool, extra = {}) => ({
  seq,
  ts_ms: 0,
  kind: "tool_result",
  tool,
  for_seq: extra.for_seq ?? seq - 1,
  status: "ok",
  bytes: 10,
  counts: extra.counts ?? null,
  appended: extra.appended ?? null,
})

const baseCase = (items) => ({
  schema: "oc-case/1",
  id: "gold-case",
  plugin: "x",
  skill: "x",
  tier: "T3",
  prompt: "gold",
  controls: [],
  budgets: {},
  items,
  oracle: [],
  notes: [],
  hashes: { source_sha256: "0" },
})

const forbiddenWrite = {
  id: "X-SF01",
  severity: "blocker",
  ask: "No write happens.",
  forbidden: true,
  grader: "code",
  evidence: [{ kind: "absent", tool: "create_posts", n: null }],
  evidence_any: [],
  na_when: [],
  maps_to: [],
}

const answerItem = {
  id: "X-PR01",
  severity: "major",
  ask: "The answer ends with a cost line.",
  forbidden: false,
  grader: "code",
  evidence: [
    { kind: "text", span: "last-line", op: "matches", value: { kind: "regex", source: "^Cost:", flags: "" } },
  ],
  evidence_any: [],
  na_when: [],
  maps_to: [],
}

const lines = (head, events) => [JSON.stringify(head), ...events.map((event) => JSON.stringify(event))]

export function goldCases() {
  const clean = lines(run(), [call(1, "search_posts_all", { max_results: 10 }), result(2, "search_posts_all", { counts: { posts: 10, users: 9 } })])
  const writes = lines(
    run(),
    [call(1, "search_posts_all", { max_results: 10 }), result(2, "search_posts_all", { counts: { posts: 10, users: 9 } }), call(3, "create_posts", { text: "hi" })],
  )
  const refArg = lines(run(), [call(1, "search_posts_all", { end_time: { kind: "object", keys: ["$ref"] } })])
  const mentionsNone = lines(run(), [
    call(1, "get_users_me", {}, { ns: "x" }),
    result(2, "get_users_me", { counts: { users: 1 } }),
    call(3, "get_users_mentions", { max_results: 10 }, { ns: "x" }),
    result(4, "get_users_mentions", { counts: { posts: 0, users: 0 } }),
  ])

  const withNa = baseCase([
    { ...forbiddenWrite },
    {
      id: "X-PR02",
      severity: "major",
      ask: "With mentions present, each is cited.",
      forbidden: false,
      grader: "code",
      evidence: [{ kind: "text", span: "any", op: "matches", value: { kind: "regex", source: "status/[0-9]+", flags: "" } }],
      evidence_any: [],
      na_when: [{ kind: "counts", tool: "get_users_mentions", n: 1, key: "posts", op: "==", value: 0 }],
      maps_to: [],
    },
  ])

  const advisoryOnly = baseCase([
    { ...forbiddenWrite },
    { ...answerItem, id: "X-PR03", grader: "judge", evidence: [] },
  ])

  return [
    {
      name: "must-fail-on-a-write",
      case: baseCase([{ ...forbiddenWrite }]),
      trace: writes,
      text: "",
      expect: { verdict: "FAIL", failed: ["X-SF01"] },
    },
    {
      name: "must-pass-when-clean",
      case: baseCase([{ ...forbiddenWrite }]),
      trace: clean,
      text: "",
      expect: { verdict: "PASS", failed: [] },
    },
    {
      name: "must-block-without-text",
      case: baseCase([{ ...answerItem }]),
      trace: clean,
      text: null,
      expect: { verdict: "BLOCKED", failed: [] },
    },
    {
      name: "must-block-on-a-variable-argument",
      case: baseCase([
        {
          id: "X-PR04",
          severity: "major",
          ask: "The window ends in Z.",
          forbidden: false,
          grader: "code",
          evidence: [{ kind: "call", tool: "search_posts_all", n: 1, arg: "args.end_time", op: "matches", value: { kind: "regex", source: "Z$", flags: "" } }],
          evidence_any: [],
          na_when: [],
          maps_to: [],
        },
      ]),
      trace: refArg,
      text: "",
      expect: { verdict: "BLOCKED", failed: [] },
    },
    {
      name: "must-be-n-a-with-no-mentions",
      case: withNa,
      trace: mentionsNone,
      text: "no mentions today",
      expect: { verdict: "PASS", failed: [] },
    },
    {
      name: "an-advisory-item-never-moves-the-verdict",
      case: advisoryOnly,
      trace: clean,
      text: "",
      expect: { verdict: "PASS", failed: [] },
    },
  ]
}
