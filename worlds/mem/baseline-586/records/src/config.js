/**
 * The service's configuration from the environment (contract §2.1).
 * A missing RECORDS_API_KEY fails startup.
 *
 * Every secret can come from a file instead (issue #39): RECORDS_API_KEY_FILE,
 * RECORDS_HELD_RECEIPT_KEY_FILE, RECORDS_FORGET_SECRET_FILE, RECORDS_CORE_KEY_FILE,
 * RECORDS_LLM_KEY_FILE.
 * A file wins over the variable, and is read once, here.
 */
import { GRANT_AUDIENCE } from "./action-grant.js"
import { registeredActNames } from "./acts.js"
import { ENGINE_MODES } from "./engine/flag.js"
import { readP2Key } from "./p2-reservation.js"
import { resolveSecretFiles } from "./secret-files.js"

/** The variables that hold secrets; each also reads `<NAME>_FILE`. */
export const RECORDS_SECRETS = Object.freeze(["RECORDS_API_KEY", "RECORDS_HELD_RECEIPT_KEY", "RECORDS_FORGET_SECRET", "RECORDS_CORE_KEY", "RECORDS_LLM_KEY"])

function int(env, name, fallback, min, max) {
  const raw = env[name]
  if (raw === undefined || raw === "") return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}; got ${JSON.stringify(raw)}`)
  }
  return value
}

function text(env, name) {
  const value = env[name]
  return value === undefined || value === "" ? null : value
}

/** RECORDS_FORGET_SECRET: unset is allowed (development); set and shorter than 32 bytes is an error, never ignored. */
function forgetSecret(env) {
  const value = text(env, "RECORDS_FORGET_SECRET")
  if (value === null) return null
  const bytes = Buffer.byteLength(value)
  if (bytes < 32) {
    throw new Error(`RECORDS_FORGET_SECRET must be at least 32 bytes (got ${bytes}). Generate one with \`openssl rand -base64 48\`, or unset it in development.`)
  }
  return value
}

/**
 * RECORDS_ACTIONS_ENABLED: the acts this service applies, comma separated. Empty
 * by default, and an empty list means every act answers `grant_action`: the
 * grant door is built but switched off until a host declares its acts (the
 * ADR's rollout, §6). Each name is checked against the acts this build
 * registers, so a name it does not register fails startup with that name in the
 * sentence, rather than silently enabling nothing. The check is the registry,
 * not the shape of a name: an act is `service.act` or `service.family.act`
 * (`space.joinRequest.decide`), and only `acts.js` knows which exist.
 */
function actionsEnabled(env) {
  const raw = text(env, "RECORDS_ACTIONS_ENABLED")
  if (raw === null) return []
  const names = raw.split(",").map((name) => name.trim()).filter(Boolean)
  const registered = new Set(registeredActNames())
  for (const name of names) {
    if (!registered.has(name)) {
      throw new Error(`RECORDS_ACTIONS_ENABLED holds ${JSON.stringify(name)}, which is not an act this build registers (such as inbox.decide or space.joinRequest.decide)`)
    }
  }
  return [...new Set(names)]
}

/**
 * @param {Record<string, string | undefined>} raw the environment
 * @param {{ readFileImpl?: (path: string, encoding: "utf8") => string }} [options]
 */
export function loadConfig(raw = process.env, options = {}) {
  // `env` is the environment with every *_FILE secret read in; the routines
  // read their keys from it (server.js passes config.env), so no file is read twice.
  const { env, warnings } = resolveSecretFiles(raw, RECORDS_SECRETS, options)
  const apiKey = text(env, "RECORDS_API_KEY")
  if (!apiKey) throw new Error("RECORDS_API_KEY is required: set it, or RECORDS_API_KEY_FILE, to the bearer key the gateway sends to this cell's records service")
  const routines = (text(env, "RECORDS_ROUTINES") ?? "off").toLowerCase()
  if (routines !== "on" && routines !== "off") throw new Error(`RECORDS_ROUTINES is on or off; got ${JSON.stringify(env.RECORDS_ROUTINES)}`)
  // Memory Jobs (DESIGN-MEMORY-JOBS): on by default. It touches only the
  // spaces that hold a job, so a space with none is read once and skipped.
  const jobs = (text(env, "RECORDS_JOBS") ?? "on").toLowerCase()
  if (jobs !== "on" && jobs !== "off") throw new Error(`RECORDS_JOBS is on or off; got ${JSON.stringify(env.RECORDS_JOBS)}`)
  // The job runner's `extract` engine is **off by default**: the design gates it
  // on its precision eval (DESIGN-MEMORY-JOBS §6.1, §13 J4).
  const jobsExtract = (text(env, "RECORDS_JOBS_EXTRACT") ?? "off").toLowerCase()
  if (jobsExtract !== "on" && jobsExtract !== "off") throw new Error(`RECORDS_JOBS_EXTRACT is on or off; got ${JSON.stringify(env.RECORDS_JOBS_EXTRACT)}`)
  // Proposing from meeting pages is **off by default** (owner, round 10): it
  // switches on only after the new held-out set passes, and a deployment that
  // turns it on says so (`on`). The owner's 2026-11-14 decision lets it run at
  // the measured proposal precision — a proposal is reviewed before anything is
  // stored — which is why it is a switch at all, and a separate one from
  // `extract`: `extract` saves nothing directly and stays off too.
  const meetingProposals = (text(env, "RECORDS_MEETING_PROPOSALS") ?? "off").toLowerCase()
  if (meetingProposals !== "on" && meetingProposals !== "off") throw new Error(`RECORDS_MEETING_PROPOSALS is on or off; got ${JSON.stringify(env.RECORDS_MEETING_PROPOSALS)}`)
  // The engine (S3a, docs/design/s3-engine-plan.md §1): off by default. `ingest`
  // numbers events, hashes their content and assigns their lane with no model
  // call; `shadow` adds S3b's leases; `on` is reserved for S8. It is not
  // RECORDS_ROUTINES_V2, which is S2's alias of RECORDS_CLAIMS.
  const engine = (text(env, "RECORDS_ENGINE") ?? "off").toLowerCase()
  if (!ENGINE_MODES.includes(engine)) throw new Error(`RECORDS_ENGINE is ${ENGINE_MODES.join(", ")}; got ${JSON.stringify(env.RECORDS_ENGINE)}`)
  // The shadow cohort and its own daily cap (S3b, design §6): the spaces the
  // engine reads while in `shadow`, and the tokens the cohort may spend in a UTC
  // day. Unset tokens means the service cap alone bounds it.
  const engineSpaces = String(text(env, "RECORDS_ENGINE_SPACES") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => /^[A-Za-z0-9_.-]{1,128}$/.test(name))
  // The shadow's own cap: unset is a fifth of the service cap, so a cohort can
  // never take the whole cell's day; `0` is no separate cap (the service cap
  // alone bounds it). A cap of zero would refuse every call, so zero means "no
  // cap" and never "spend nothing" (review M3).
  const serviceBudgetTokens = int(env, "RECORDS_SERVICE_BUDGET_TOKENS", 3_000_000, 0, 1_000_000_000)
  const shadowCap = text(env, "RECORDS_ENGINE_SHADOW_TOKENS")
  // The canary's space (plan §4): a fixture event every fifteen minutes, and a
  // page when one is not committed within the `own` target.
  const engineCanarySpace = text(env, "RECORDS_ENGINE_CANARY_SPACE")
  const engineShadowTokens = shadowCap === null ? Math.floor(serviceBudgetTokens / 5) : int(env, "RECORDS_ENGINE_SHADOW_TOKENS", Math.floor(serviceBudgetTokens / 5), 0, 1_000_000_000)
  const jobsConfig = {
    extract: jobsExtract,
    meetingProposals,
    extractBudgetTokens: int(env, "RECORDS_JOBS_EXTRACT_TOKENS", 15000, 0, 1_000_000),
    jobDailyTokens: int(env, "RECORDS_JOBS_DAILY_TOKENS", 40000, 0, 100_000_000),
    // The job runner's own default is 3; the service's one breaker keeps the
    // routines' documented 5 (0.11), so sharing it changes nothing a person set.
    breakerFailures: int(env, "RECORDS_LLM_BREAKER_FAILURES", 5, 1, 100),
  }
  // The one model breaker the routines and the jobs share (0.11): N failed
  // calls in a row open it for the space, and it closes after this cool-down.
  const modelBreaker = {
    breakerFailures: jobsConfig.breakerFailures,
    breakerCooldownMs: int(env, "RECORDS_LLM_BREAKER_COOLDOWN_MINUTES", 60, 1, 1440) * 60_000,
  }
  return {
    port: int(env, "RECORDS_PORT", 8430, 0, 65535),
    bind: text(env, "RECORDS_BIND") ?? "0.0.0.0",
    dataDir: text(env, "RECORDS_DATA_DIR") ?? "/data/records",
    apiKey,
    heldReceiptKey: text(env, "RECORDS_HELD_RECEIPT_KEY"),
    // Derives forget purge salts and the text tombstone key (docs/design/forget-erase.md).
    // Production must set it; when set it is 32 bytes or more, else startup fails.
    forgetSecret: forgetSecret(env),
    coreUrl: text(env, "RECORDS_CORE_URL"),
    coreKey: text(env, "RECORDS_CORE_KEY"),
    // The hub, for the personal space's skills, wikis and code graphs: an
    // erasure deletes the assets control registered for that space.
    // person.erase is the account-deletion feed's step, never a caller's: it
    // runs only with this credential, which control holds. Unset refuses it.
    eraseKey: text(env, "RECORDS_ERASE_KEY"),
    knowledgeUrl: text(env, "RECORDS_KNOWLEDGE_URL"),
    knowledgeKey: text(env, "RECORDS_KNOWLEDGE_KEY"),
    llmUrl: text(env, "RECORDS_LLM_URL"),
    llmModel: text(env, "RECORDS_LLM_MODEL"),
    llmKey: text(env, "RECORDS_LLM_KEY"),
    routines,
    jobs,
    engine,
    engineSpaces,
    engineShadowTokens,
    canarySpace: engineCanarySpace,
    jobsConfig,
    modelBreaker,
    routineHour: int(env, "RECORDS_ROUTINE_HOUR", 18, 0, 23),
    budgetTokens: int(env, "RECORDS_BUDGET_TOKENS", 150000, 0, 1_000_000_000),
    // One extraction call's DATA size and output cap (records/README.md); the
    // routines read them themselves, and the service refuses a bad value too.
    routineBatchChars: int(env, "RECORDS_ROUTINE_BATCH_CHARS", 24000, 1_000, 1_000_000),
    routineMaxOutputTokens: int(env, "RECORDS_ROUTINE_MAX_OUTPUT_TOKENS", 4000, 256, 200_000),
    eventRetentionDays: int(env, "RECORDS_EVENT_RETENTION_DAYS", 30, 1, 3650),
    // How many space files one process keeps open (design §10.5, plan §4): 128
    // until it was configurable, and sized to the cell's active set.
    maxOpen: int(env, "RECORDS_MAX_OPEN", 128, 1, 10_000),
    proposalTtlDays: int(env, "RECORDS_PROPOSAL_TTL_DAYS", 30, 1, 3650),
    // Keyed-write receipts (docs/design/records-idempotency.md).
    receiptTtlHours: int(env, "RECORDS_RECEIPT_TTL_HOURS", 24, 1, 168),
    receiptMax: int(env, "RECORDS_RECEIPT_MAX", 50_000, 1_000, 10_000_000),
    // Verified-caller grants (docs/design/adr-verified-caller-grants.md §4.3):
    // public action keys from a file, the audience they are bound to, and the
    // acts this service applies. No key file means no grant verifies.
    actionKeysFile: text(env, "RECORDS_ACTION_KEYS_FILE"),
    actionAudience: text(env, "RECORDS_ACTION_AUDIENCE") ?? GRANT_AUDIENCE,
    // A key file older than this fails closed (§4.3): the hosts' revocations
    // apply only while the puller keeps the file fresh. 0 disables the limit.
    actionKeysMaxAgeMs: int(env, "RECORDS_ACTION_KEYS_MAX_AGE_HOURS", 24, 0, 8760) * 3_600_000,
    actionsEnabled: actionsEnabled(env),
    // The shared reservation key for a control-plane act
    // (docs/design/p2-control.md). Set, a G2-P act's reservation answers a
    // proof the gateway carries and control spends; unset, no proof is issued.
    p2Key: readP2Key(text(env, "P2_RESERVATION_KEY")),
    warnings,
    env,
  }
}

/** Why Memory Jobs cannot run with this configuration, or null when they can. */
export function jobsOffReason(config) {
  return config.jobs === "on" ? null : "RECORDS_JOBS is off"
}

/** Why routines cannot run with this configuration, or null when they can. */
export function routinesOffReason(config) {
  if (config.routines !== "on") return "RECORDS_ROUTINES is off"
  const missing = []
  if (!config.llmUrl) missing.push("RECORDS_LLM_URL")
  if (!config.llmModel) missing.push("RECORDS_LLM_MODEL")
  return missing.length ? `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set` : null
}
