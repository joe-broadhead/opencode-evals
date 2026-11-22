/**
 * Memory Jobs: the fixed template (slice J0) and the templates a connector
 * ships (slice J2, DESIGN-MEMORY-JOBS §9.4).
 *
 * The fixed template is **data**, not frame: the connector id, the source, the
 * page prefix and the grants are the template's content, and the runner has no
 * plugin names in it (DESIGN §7.2). A declared template is read from the
 * declaration the machine last reported, and its grants are the set §9.1 D
 * defines, never the template's own: a template carries no grants and no
 * account, so it can never widen what the person confirmed.
 */
import { jobGrants } from "../plugins/manifest.js"

/** The J0 template: Slack threads → a `render` lens block on one project page. */
export const SLACK_THREADS_RENDER = Object.freeze({
  id: "slack-threads-project",
  name: "Slack threads → project page",
  connector: "slack.workspace",
  source: "slack",
  extract: Object.freeze([Object.freeze({ use: "events_list", connector: "slack.workspace" })]),
  transform: Object.freeze({ into: "events" }),
  curate: Object.freeze([
    Object.freeze({
      engine: "render",
      stage: "threads",
      // The page the block is owned on. `{{project}}` is the person's choice at create.
      page: "projects/{{project}}",
      maxLines: 100,
    }),
  ]),
  /** The event kinds the template collects. */
  kinds: Object.freeze(["message"]),
  /** The exact read actions the job's session may run, and nothing else (DESIGN §5.3). */
  grants: Object.freeze([
    Object.freeze({ action: "slack_events_list", resource: "*" }),
    Object.freeze({ action: "slack_slack_read_user_profile", resource: "*" }),
    Object.freeze({ action: "slack_slack_read_channel", resource: "*" }),
  ]),
  /** The budget J0 enforces: pages a run, items a run, items a page (DESIGN §4.3). */
  budgets: Object.freeze({ pagesPerRun: 5, pageLimit: 200, itemsPerRun: 1000, toolCallsPerRun: 60 }),
  /** How often the server makes a run due, at least 5 minutes (DESIGN §4.1). */
  every: "30m",
})

// ---------------------------------------------------------------------------
// Memory's own template library, keyed by source id and event kind (§8.3.5).
//
// **Plugins ship no templates:** a template is consumer-specific data, so it
// lives in Memory. The descriptor gives Memory the source id, the kind and, for
// a snapshot, its output schema — enough to choose a template. A source with no
// template here still collects, and daily's generic passes curate it.

/** The library, one entry per (source id, event kind): what each template reads and what it may write. */
export const SOURCE_TEMPLATES = Object.freeze(
  [
    {
      id: "gmail-commitments",
      title: "Promises and people from your mail",
      summary: "Proposes the commitments and the people your messages name, for review.",
      sources: Object.freeze(["gws.gmail", "gmail"]),
      kinds: Object.freeze(["message"]),
      outputs: Object.freeze(["proposal:commitment", "proposal:person"]),
      stage: "extract",
      every: "1d",
      name: "Gmail commitments",
    },
    {
      id: "slack-thread-decisions",
      title: "Decisions from your threads",
      summary: "A cited block of what your threads decided, on the project page you choose.",
      sources: Object.freeze(["slack.workspace", "slack"]),
      kinds: Object.freeze(["message"]),
      outputs: Object.freeze(["journal", "section:Decisions"]),
      stage: "render",
      every: "30m",
      name: "Slack decisions",
    },
    {
      id: "calendar-meeting-pages",
      title: "Meeting pages from today's calendar",
      summary: "A page per meeting tomorrow, with its attendees and its agenda line.",
      sources: Object.freeze(["gws.calendar.today", "gws.calendar"]),
      kinds: Object.freeze(["meeting", "agenda"]),
      outputs: Object.freeze(["page:meetings"]),
      stage: "render",
      every: "1d",
      name: "Meeting pages",
    },
    {
      id: "github-weekly-digest",
      title: "The week's pull requests",
      summary: "A cited line per pull request that changed this week.",
      sources: Object.freeze(["github.pull-requests", "github"]),
      kinds: Object.freeze(["pr"]),
      outputs: Object.freeze(["journal"]),
      stage: "render",
      every: "7d",
      name: "GitHub digest",
    },
  ].map((entry) =>
    Object.freeze({
      ...entry,
      // The same shape a declared template has, so the runner treats them alike.
      extract: Object.freeze([Object.freeze({ use: "events_list", source: entry.sources[0] })]),
      transform: Object.freeze({ into: "events" }),
      curate: Object.freeze([Object.freeze({ engine: entry.stage, stage: entry.stage, maxLines: 50 })]),
      budgets: Object.freeze({ pagesPerRun: 5, pageLimit: 200, itemsPerRun: 1000, toolCallsPerRun: 60 }),
    }),
  ),
)

/** Every template the library offers for a source and an event kind (or a snapshot output), in library order. */
export function templatesForSource(source, kind) {
  return SOURCE_TEMPLATES.filter((template) => template.sources.includes(source) && template.kinds.includes(kind))
}

/** Every template Memory itself ships: the built-in, and the source library's. */
export function templateLibrary() {
  return [...JOB_TEMPLATES, ...SOURCE_TEMPLATES]
}

export const JOB_TEMPLATES = Object.freeze([SLACK_THREADS_RENDER])

/** The template with this id, or null. */
export function templateOf(id) {
  return templateLibrary().find((template) => template.id === id) ?? null
}



// ---------------------------------------------------------------------------
// A template a connector ships (schema v2, DESIGN §9.4)

/** The `"<plugin id>/<template id>"` a job created from a declaration names, or null for a built-in one. */
export function declaredTemplateRef(value) {
  if (typeof value !== "string") return null
  const at = value.indexOf("/")
  if (at <= 0 || at === value.length - 1) return null
  return { connector: value.slice(0, at), template: value.slice(at + 1) }
}

/** A refusal the caller sees as a 400 with its own code (a template that cannot become a job). */
function declaredRefusal(code, message, next) {
  return Object.assign(new Error(message), { code, next, status: 400, name: "RecordsError" })
}

/** The page a render stage writes: the day's journal, or the job's own page. */
export const JOURNAL_PAGE = "journal/{{date}}"

/**
 * The engines this build runs. `synthesize` is slice J4 (§13); a template that
 * asks for it is refused at create, by name, rather than silently half-run.
 */
export const RUNNABLE_ENGINES = Object.freeze(["render", "extract"])

/** The interval a template's trigger names, as milliseconds (the source's cadence when it names none). */
function triggerMs(schedule, fallbackMs) {
  const every = typeof schedule?.every === "string" ? schedule.every : null
  if (!every) return fallbackMs
  const size = Number(every.slice(0, -1))
  const unit = every.slice(-1)
  const ms = unit === "m" ? size * 60_000 : unit === "h" ? size * 3_600_000 : size * 86_400_000
  // The runner's floor is five minutes; anything shorter is a job that would never rest.
  return Math.max(300_000, ms)
}

/**
 * A version's doc for a job made from a connector's template (§2.4, §9.4).
 *
 * The template carries no grants and no account: both come from the binding, so
 * a template can never widen what the person confirmed. The grants are the set
 * §9.1 D defines, computed from the declaration the machine last reported.
 *
 * @param {{connector: string, manifest: any, template: any, account: string, owner: object|null, scope: object, page: string|null, every: string|number|null}} input
 */
export function docFromDeclaredTemplate({ connector, manifest, template, account, owner, scope, page, every }) {
  const steps = template.extract.steps
  const sources = [...new Set(steps.map((step) => step.source))]
  if (sources.length !== 1) throw declaredRefusal("job_multi_source", `This template reads ${sources.join(" and ")}; a job reads one source.`, "Make a job for each source, or ask the plugin for a template that reads one.")
  const source = sources[0]
  const declared = (manifest.sources ?? []).find((entry) => entry.id === source)
  if (!declared) throw declaredRefusal("job_plugin_missing", `The declaration has no source ${String(source)}.`, "Update the plugin, or confirm the source it declares.")
  const stages = template.curate.stages
  const unsupported = stages.find((stage) => !RUNNABLE_ENGINES.includes(stage.engine))
  if (unsupported) throw declaredRefusal("job_stage_engine", `This build runs ${RUNNABLE_ENGINES.join(" and ")} stages, and the template asks for ${String(unsupported.engine)}.`, "Turn the template on once Memory's job runner supports that engine, or use a template whose stages it runs.")
  const render = stages.find((stage) => stage.engine === "render")
  const grants = jobGrants(manifest, { source, account, steps })
  return {
    name: template.title,
    template: `${connector}/${template.id}`,
    connector,
    source,
    account,
    owner,
    scope,
    kinds: [...declared.kinds],
    grants,
    page: render?.into === "journal" ? JOURNAL_PAGE : page,
    stage: render?.into ?? stages[0].engine,
    every_ms: triggerMs(template.trigger?.schedule, every),
    extract: steps,
    transform: template.transform ?? { into: "events" },
    curate: stages.map((stage) => ({ ...stage, ...(stage.max ? { maxLines: stage.max } : {}) })),
    outputs: template.outputs ?? [],
    budgets: { pagesPerRun: 5, pageLimit: 200, itemsPerRun: 1000, toolCallsPerRun: 60, ...(template.budget?.tokensPerRun ? { tokensPerRun: template.budget.tokensPerRun } : {}) },
    // §9.4: the hosts a `{url}` in a line may point at, from the connector that
    // declared them; a line's link renders only to one of these.
    urlHosts: Array.isArray(manifest?.connector?.urlHosts) ? [...manifest.connector.urlHosts] : [],
  }
}
