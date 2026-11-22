/**
 * The routines' model client: OpenAI-compatible `POST {url}/chat/completions`
 * with a JSON response format, a 150 s timeout, one retry on a 5xx, and a
 * fallback that reads the first JSON object out of a prose answer.
 *
 * The budget (RECORDS_BUDGET_TOKENS per space per local day, all routines) is
 * kept in the space: every run records its tokens in the run ledger
 * (`putRun`), and a run's allowance is the cap minus what the day's other runs
 * already used.
 */
import { dayBounds } from "./dates.js"
import { createAttemptObserver } from "../telemetry/model-attempts.js"

export class LlmError extends Error {
  constructor(message, { status = 0, code = "llm_failed", retryAfterMs = 0, cell = false } = {}) {
    super(message)
    this.name = "LlmError"
    this.status = status
    this.code = code
    /** A 429's `Retry-After`, in ms: how long the provider asked to wait. */
    this.retryAfterMs = retryAfterMs
    /** True when a cell-wide breaker refused the call before it was made. */
    this.cell = cell
  }
}

/** The longest `Retry-After` a run waits: a longer one ends the run and the scheduler comes back. */
export const RETRY_AFTER_MAX_MS = 120_000

/**
 * `Retry-After` as milliseconds: the header's delta seconds, or its HTTP date.
 * Anything else is 0, which means the caller waits its own small back-off.
 */
export function retryAfterMs(value, nowMs = Date.now()) {
  const text = String(value ?? "").trim()
  if (!text) return 0
  const seconds = Number(text)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), RETRY_AFTER_MAX_MS)
  const at = Date.parse(text)
  if (!Number.isFinite(at)) return 0
  return Math.min(Math.max(0, at - nowMs), RETRY_AFTER_MAX_MS)
}

export class BudgetExhausted extends Error {
  constructor(used, limit, scope = "space") {
    super(scope === "service" ? `the service's daily model budget is spent (${used} of ${limit} tokens)` : `the daily model budget is spent (${used} of ${limit} tokens)`)
    this.name = "BudgetExhausted"
    this.code = "budget"
    this.scope = scope
  }
}

/** Rough tokens for a text: four characters each. */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 4)
}

/**
 * The first balanced JSON object in a text, parsed; null when there is none.
 * Strings are respected, so a brace inside a quoted value does not end it.
 */
export function firstJsonObject(text) {
  const value = String(text ?? "")
  for (let start = value.indexOf("{"); start !== -1; start = value.indexOf("{", start + 1)) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < value.length; i += 1) {
      const c = value[i]
      if (inString) {
        if (escaped) escaped = false
        else if (c === "\\") escaped = true
        else if (c === '"') inString = false
        continue
      }
      if (c === '"') inString = true
      else if (c === "{") depth += 1
      else if (c === "}") {
        depth -= 1
        if (depth === 0) {
          try {
            return JSON.parse(value.slice(start, i + 1))
          } catch {
            break
          }
        }
      }
    }
  }
  return null
}

export function parseJsonAnswer(content) {
  const text = String(content ?? "").trim()
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
  } catch {
    // fall through to extraction
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fenced) {
    const inner = firstJsonObject(fenced[1])
    if (inner) return inner
  }
  return firstJsonObject(text)
}

/**
 * The complete items of an answer cut off at the output cap. The items array is
 * walked by brace depth and strings; every object that closes is kept and the
 * unterminated tail is dropped, so a cut answer loses only its last item
 * (FINDINGS 3.1: a truncated answer failed the whole batch as `bad_answer`).
 * @returns {any[]} the complete items, in order
 */
export function completeItems(text) {
  const value = String(text ?? "")
  const at = value.search(/"items"\s*:\s*\[/)
  if (at === -1) return []
  const items = []
  let i = value.indexOf("[", at) + 1
  for (;;) {
    while (i < value.length && /[\s,]/.test(value[i])) i += 1
    if (i >= value.length || value[i] === "]") break
    if (value[i] !== "{") break
    const start = i
    let depth = 0
    let inString = false
    let escaped = false
    let end = -1
    for (; i < value.length; i += 1) {
      const c = value[i]
      if (inString) {
        if (escaped) escaped = false
        else if (c === "\\") escaped = true
        else if (c === '"') inString = false
        continue
      }
      if (c === '"') inString = true
      else if (c === "{") depth += 1
      else if (c === "}") {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end === -1) break
    try {
      items.push(JSON.parse(value.slice(start, end + 1)))
    } catch {
      break
    }
    i = end + 1
  }
  return items
}

/**
 * @param {{url?: string, model?: string, key?: string, timeoutMs?: number, fetchImpl?: typeof fetch, log?: any, costPer1kTokens?: number}} options
 */
export function createLlm(options = {}) {
  const url = String(options.url ?? "").replace(/\/+$/, "")
  const model = options.model ?? ""
  const timeoutMs = options.timeoutMs ?? 150_000
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const costPer1k = Number(options.costPer1kTokens ?? 0) || 0
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const observer = options.observer ? createAttemptObserver({ ...options.observer, model, excludedValues: [options.key] }) : null

  async function post(body, space = null, observation = null, spend) {
    // What the shim's spend line needs to attribute the call (lane 0183): the
    // service, and the space when the caller names one. The shim hashes the
    // space; records never logs it raw, and this header is internal.
    const headers = { "content-type": "application/json", "x-mem-caller": "records" }
    if (space) headers["x-mem-space"] = String(space).slice(0, 128)
    if (options.key) headers.authorization = `Bearer ${options.key}`
    let response
    await observation?.dispatched()
    let text
    try {
      spend.calls += 1
      response = await fetchImpl(`${url}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      text = await response.text()
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError"
      const failure = new LlmError(timedOut ? `the model did not answer within ${Math.round(timeoutMs / 1000)} s` : "the model is unreachable", {
        status: 0,
        code: timedOut ? "llm_timeout" : "llm_unreachable",
      })
      // Keep classification, never arbitrary network messages or credentials.
      const code = error?.cause?.code ?? error?.code
      if (["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) failure.cause = { code }
      await observation?.failed(failure.code, response?.status)
      throw failure
    }
    let answer
    try { answer = JSON.parse(text) } catch { /* A safe error below, never the response body. */ }
    if (!response.ok) {
      // Preserve legacy retry/budget behavior, not a claim of zero provider spend.
      const rateLimited = response.status === 429
      const failure = new LlmError(`the model answered ${response.status}`, {
        status: response.status,
        code: rateLimited ? "llm_rate_limited" : "llm_failed",
        retryAfterMs: rateLimited ? retryAfterMs(response.headers?.get?.("retry-after")) : 0,
      })
      if (response.status === 400) {
        const hint = text.slice(0, 200)
        failure.compatibility = []
        if (/reasoning/i.test(hint)) failure.compatibility.push("reasoning")
        if (/response_format|json_object/i.test(hint) || (!/reasoning/i.test(hint) && /json/i.test(hint))) failure.compatibility.push("response_format")
      }
      await observation?.response(response.status, answer?.usage, null, failure.code)
      throw failure
    }
    if (answer === undefined) {
      await observation?.response(response.status, null, null, "llm_bad_answer")
      throw new LlmError("the model's answer was not JSON", { status: response.status, code: "llm_bad_answer" })
    }
    await observation?.response(response.status, answer?.usage, { input: body.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0), output: estimateTokens(answer?.choices?.[0]?.message?.content) })
    return answer
  }

  /**
   * One request, one retry on a 5xx or a network failure, and one after a 429
   * that waits what `Retry-After` named. Only what the provider bills is charged
   * (scale H5): an answer's own usage, and the prompt of a timeout after sending
   * — a refused, failed or rate-limited call bills nothing.
   */
  async function postWithRetry(body, spend, rateLimitRetry = true, space = null, operation = null, retryKind = "initial") {
    let server = 0
    let limited = 0
    const attempt = async () => {
      spend.observation = await operation?.reserve(retryKind)
      try {
        return await post(body, space, spend.observation, spend)
      } catch (error) {
        if (error?.code === "llm_timeout") spend.tokens += spend.prompt
        throw error
      }
    }
    for (;;) {
      try {
        return await attempt()
      } catch (error) {
        // A caller that would rather carry the wait (the engine's tier's
        // `not_before`) says so, and nothing here sleeps (plan §4).
        if (error?.status === 429 && rateLimitRetry && limited < 1) {
          limited += 1
          retryKind = "rate_limit"
          await sleep(Math.max(0, Number(error.retryAfterMs) || 0))
          continue
        }
        if (error instanceof LlmError && (error.status >= 500 || error.code === "llm_unreachable") && server < 1) {
          server += 1
          retryKind = error.code === "llm_unreachable" ? "network" : "server"
          continue
        }
        throw error
      }
    }
  }

  return {
    available: Boolean(url && model),
    model,

    /**
     * @param {{system: string, user: string, maxTokens?: number}} input
     * @returns {Promise<{json: object|null, content: string, usage: {prompt: number, completion: number, total: number}, cost: number}>}
     */
    async complete({ system, user, maxTokens = 4000, rateLimitRetry = true, space = null }) {
      if (!url || !model) throw new LlmError("no model is configured (RECORDS_LLM_URL, RECORDS_LLM_MODEL)", { code: "llm_unconfigured" })
      const body = {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        // Extraction is a schema, not a chain of thought. Models that reason
        // by default (DeepSeek V4.1 Flash does, at high effort) spend the
        // token cap on reasoning and paraphrase past the quote's wording.
        reasoning: { effort: "none" },
      }
      // What the failed attempts cost; added to the answer's usage, or carried by the error.
      const spend = { calls: 0, tokens: 0, prompt: estimateTokens(system) + estimateTokens(user) }
      const operation = observer?.operation()
      let answer
      try {
        try {
          answer = await postWithRetry(body, spend, rateLimitRetry, space, operation)
        } catch (error) {
          // Some OpenAI-compatible servers refuse response_format or reasoning:
          // drop the field they named and read the first JSON object.
          if (error instanceof LlmError && error.status === 400 && error.compatibility?.length) {
            const plain = { ...body }
            if (error.compatibility.includes("reasoning")) delete plain.reasoning
            if (error.compatibility.includes("response_format")) delete plain.response_format
            answer = await postWithRetry(plain, spend, rateLimitRetry, space, operation, "compatibility")
          } else throw error
        }
        const content = String(answer?.choices?.[0]?.message?.content ?? "")
        // An answer cut off at the output cap still holds complete items: keep
        // them and flag the batch, rather than failing it whole as `bad_answer`.
        let json = parseJsonAnswer(content)
        // A cut answer can still balance as an inner item, so the test is "no
        // items array", not "no object".
        if (!json || !Array.isArray(json.items)) {
          const items = completeItems(content)
          if (items.length > 0) json = { items, truncated: true }
        }
        const prompt = Number(answer?.usage?.prompt_tokens) || estimateTokens(system) + estimateTokens(user)
        const completion = Number(answer?.usage?.completion_tokens) || estimateTokens(content)
        const total = (Number(answer?.usage?.total_tokens) || prompt + completion) + spend.tokens
        await spend.observation?.delivered()
        return { json, content, calls: spend.calls, usage: { prompt, completion, total, failed: spend.tokens }, cost: (total / 1000) * costPer1k }
      } catch (error) {
        if (error && typeof error === "object") {
          error.tokens = spend.tokens
          error.calls = spend.calls
        }
        throw error
      }
    },
  }
}

/**
 * The budget of one run: the space's cap per **local** day, minus what that
 * day's other runs used, read from the ledgers at the start of the run (summed
 * by the store, so no run falls out of a page; FABLE records #5). A run holds
 * the space's routine lock, so no other run of the space spends meanwhile.
 * `service` is the service-wide cap: `{limit, used()}`, shared by every space.
 *
 * @param {{space: any, actor: any, day: string, tz?: string, limit: number, run: {id: string, tokens: number}, service?: {limit: number, used(): number} | null}} input
 */
export async function openBudget({ space, actor, day, tz = "UTC", limit, allowance = undefined, run, service = null }) {
  let others
  // One budget for the space's routines **and** its jobs (0.11,
  // records/src/model-guard.js): the routines' `runs` and the jobs' `job_runs`
  // are one day's spend, so what a job spent is not the routines' to spend
  // again. The day is the space's own, its local midnight to the next one in
  // UTC (`dates.js` `dayBounds`), which is the window the guard uses too. This
  // run's own tokens are part of that sum and are not counted twice.
  if (typeof space.modelTokens === "function") {
    const { start, end } = dayBounds(day, tz)
    others = Math.max(0, (await space.modelTokens({ from: start, to: end }, actor)).tokens - (Number(run.tokens) || 0))
  } else if (typeof space.runTokens === "function") others = (await space.runTokens({ budget_day: day, exclude: run.id }, actor)).tokens
  else {
    const { runs } = await space.listRuns({ budget_day: day, limit: 200 }, actor)
    others = runs.filter((r) => r.id !== run.id).reduce((sum, r) => sum + (Number(r.tokens) || 0), 0)
  }
  return {
    limit,
    used: () => others + run.tokens,
    remaining: () => Math.max(0, limit - others - run.tokens),
    /** Throws BudgetExhausted when a call of about `tokens` would pass the space's cap or the service's. */
    check(tokens) {
      // A catch-up run's allowance is its own share of the day, on top of what
      // the day already spent: its own calls stop at `allowance`, and the day's
      // cap still bounds the two together (FINDINGS R6).
      const cap = Number.isFinite(allowance) ? Math.min(limit, others + allowance) : limit
      if (others + run.tokens + tokens > cap) throw new BudgetExhausted(others + run.tokens, cap)
      if (service && service.used() + tokens > service.limit) throw new BudgetExhausted(service.used(), service.limit, "service")
    },
  }
}
