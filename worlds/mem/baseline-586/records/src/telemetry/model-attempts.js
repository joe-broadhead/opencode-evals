import { randomUUID } from "node:crypto"

const count = (value) => Number.isSafeInteger(value) && value >= 0
const observed = (value) => ({ value: count(value) ? value : null, certainty: count(value) ? "observed" : "unknown" })
const estimated = (value) => ({ value: count(value) ? value : null, certainty: count(value) ? "estimated" : "unknown" })
const unknownMoney = () => ({ certainty: "unknown", amount: null, invoiceVerified: false })
const LABEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,95}$/
const identifier = (value, pattern) => typeof value === "string" && pattern.test(value)

function priceSnapshot(value) {
  if (!value || !/^[A-Z]{3}$/.test(value.currency) || ![value.id, value.provider].every((v) => identifier(v, LABEL_ID)) || !identifier(value.model, MODEL_ID)) return null
  const rate = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1_000_000
  if (!rate(value.inputPerMillion) || !rate(value.outputPerMillion) || (value.cachedInputPerMillion !== undefined && !rate(value.cachedInputPerMillion))) return null
  return { id: value.id, provider: value.provider, model: value.model, currency: value.currency,
    inputPerMillion: value.inputPerMillion, outputPerMillion: value.outputPerMillion,
    ...(value.cachedInputPerMillion !== undefined ? { cachedInputPerMillion: value.cachedInputPerMillion } : {}) }
}

function measurement(usage, estimates, price) {
  const result = {}
  for (const [key, value] of Object.entries({ input: usage?.prompt_tokens, output: usage?.completion_tokens, total: usage?.total_tokens,
    cachedInput: usage?.prompt_tokens_details?.cached_tokens, reasoning: usage?.completion_tokens_details?.reasoning_tokens })) {
    if (value !== undefined) result[key] = observed(value)
  }
  for (const key of ["input", "output"]) if (!result[key]) result[key] = estimated(estimates?.[key])
  if (!result.total) result.total = estimated(result.input.value !== null && result.output.value !== null ? result.input.value + result.output.value : null)
  for (const [subset, whole] of [["cachedInput", "input"], ["reasoning", "output"]]) {
    if (result[subset]?.value > result[whole]?.value) result[subset] = observed(null)
  }
  const values = Object.values(result)
  const certainty = values.some((v) => v.certainty === "unknown") ? "unknown" : values.some((v) => v.certainty === "estimated") ? "estimated" : "observed"
  let money = unknownMoney()
  if (price && certainty !== "unknown") {
    const cached = result.cachedInput?.value ?? 0
    if (!cached || price.cachedInputPerMillion !== undefined) {
      const amount = ((result.input.value - cached) * price.inputPerMillion + cached * (price.cachedInputPerMillion ?? 0) + result.output.value * price.outputPerMillion) / 1_000_000
      money = { certainty: "estimated", amount, currency: price.currency, priceBasis: price, invoiceVerified: false }
    }
  }
  return { certainty, usage: result, money }
}

/** Internal only. A rejected write must never become a provider retry. */
export class ObservationPersistenceError extends Error {
  constructor(observation) {
    super("model observation persistence failed")
    this.name = "ObservationPersistenceError"
    this.code = "observation_persist_failed"
    this.observation = structuredClone(observation)
  }
}

/** The sink must resolve only after committing its own short transaction. */
export function createAttemptObserver({ sink, newId = randomUUID, now = Date.now, priceBasis, provider, model, excludedValues = [] } = {}) {
  if (typeof sink?.write !== "function") throw new TypeError("model observation sink is required")
  const safe = (value, pattern) => identifier(value, pattern) && !excludedValues.some((secret) => typeof secret === "string" && secret.length > 0 && value.includes(secret))
  const safeProvider = safe(provider, LABEL_ID) ? provider : undefined
  const safeModel = safe(model, MODEL_ID) ? model : undefined
  const snapshot = priceSnapshot(priceBasis)
  const price = snapshot && snapshot.provider === safeProvider && snapshot.model === safeModel && Object.values(snapshot).every((v) => typeof v !== "string" || !excludedValues.some((secret) => secret && v.includes(secret))) ? snapshot : null
  function invalid() {
    return Object.assign(new Error("invalid model observation configuration"), { code: "observation_invalid_config" })
  }
  function id() {
    let value
    try { value = newId() } catch { throw invalid() }
    if (!safe(value, /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/)) throw invalid()
    return value
  }
  return {
    operation() {
      const operationId = id()
      const ids = new Set([operationId])
      let previous = null
      return {
        async reserve(retryKind = "initial") {
          const attemptId = id()
          if (ids.has(attemptId)) throw invalid()
          ids.add(attemptId)
          const state = {
            version: 1, operationId, attemptId, retryParentId: previous,
            retryKind: ["initial", "network", "server", "rate_limit", "compatibility"].includes(retryKind) ? retryKind : "initial",
            ...(safeProvider ? { provider: safeProvider } : {}), ...(safeModel ? { model: safeModel } : {}),
            dispatch: "reserved", measurement: { certainty: "reserved", usage: null, money: unknownMoney() },
            applicationDisposition: "pending", resultDelivery: "pending",
          }
          previous = state.attemptId
          async function write() {
            let at
            try { at = now() } catch { throw invalid() }
            if (!count(at) || at > 8_640_000_000_000_000) throw invalid()
            const event = structuredClone({ ...state, at })
            try { await sink.write(structuredClone(event)) }
            catch { throw new ObservationPersistenceError(event) }
          }
          await write()
          return {
            async dispatched() { state.dispatch = "dispatched"; state.measurement.certainty = "unknown"; await write() },
            async response(status, usage, estimates, code) {
              state.dispatch = "response_known"
              if (Number.isInteger(status) && status >= 100 && status <= 599) state.httpStatus = status
              state.measurement = measurement(usage, estimates, price)
              if (["llm_failed", "llm_rate_limited", "llm_bad_answer"].includes(code)) state.code = code
              await write()
            },
            async failed(code, status) {
              state.dispatch = code === "llm_timeout" ? "timed_out" : "failed"
              state.code = code === "llm_timeout" ? "llm_timeout" : "llm_unreachable"
              if (Number.isInteger(status) && status >= 100 && status <= 599) state.httpStatus = status
              state.measurement = { certainty: "unknown", usage: null, money: unknownMoney() }
              await write()
            },
            async delivered() { state.resultDelivery = "delivered"; await write() },
          }
        },
      }
    },
  }
}
