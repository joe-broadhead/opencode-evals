/** D2B-local synchronous dependency contract, not a transaction manager. */
import { types } from "node:util"

const faults = new WeakSet()
const asyncPrototype = Object.getPrototypeOf(async () => {})
const generatorPrototype = Object.getPrototypeOf(function* () {})
const asyncGeneratorPrototype = Object.getPrototypeOf(async function* () {})
const fault = (code) => {
  const error = new Error(code)
  faults.add(error)
  return error
}
export const readerFault = (error) => faults.has(error)

// Never execute configuration getters or proxy traps to discover a dependency.
export function readerOption(config, key) {
  if (!config || typeof config !== "object" && typeof config !== "function" || types.isProxy(config)) throw fault("invalid_silver_ingest_configuration")
  const prototype = Object.getPrototypeOf(config)
  if (![null, Object.prototype, Function.prototype].includes(prototype)) throw fault("invalid_silver_ingest_configuration")
  const property = Object.getOwnPropertyDescriptor(config, key)
  if (property && !("value" in property) || !property && key in config) throw fault("invalid_silver_ingest_configuration")
  return property?.value
}

export function syncDependency(fn) {
  if (fn === undefined || fn === null) return null
  if (typeof fn !== "function" || types.isProxy(fn) || types.isAsyncFunction(fn) || types.isGeneratorFunction(fn) || [asyncPrototype, generatorPrototype, asyncGeneratorPrototype].includes(Object.getPrototypeOf(fn))) throw fault("invalid_silver_ingest_configuration")
  return fn
}

export function installedSilver(options) {
  const hook = syncDependency(readerOption(options, "silverIngest"))
  if (!hook) return null
  const prepare = syncDependency(readerOption(hook, "prepare"))
  const current = syncDependency(readerOption(hook, "current"))
  // Snapshot validated dependencies; later mutation cannot install async hooks.
  const installed = (tx, page) => syncValue(Reflect.apply(hook, undefined, [tx, page]), "async_silver_ingest")
  if (prepare) installed.prepare = (raw) => syncValue(Reflect.apply(prepare, undefined, [raw]), "async_silver_prepare")
  if (current) installed.current = (tx, page, delta) => {
    const { eraseDerivative, ...readPage } = page
    return readCall(current, tx, [readPage, delta], "async_silver_recheck")
  }
  return Object.freeze(installed)
}

export function syncValue(value, code) {
  if (types.isPromise(value)) {
    // Ordinary native Promise rejections are consumed without awaiting them.
    // The facade is already closed before their continuation can run.
    Promise.prototype.then.call(value, undefined, () => {})
    throw fault(code)
  }
  if (value && (typeof value === "object" || typeof value === "function")) {
    if (types.isProxy(value)) return value // The DTO validator rejects it without traps.
    if (![null, Object.prototype, Array.prototype, Function.prototype].includes(Object.getPrototypeOf(value))) return value
    const then = Object.getOwnPropertyDescriptor(value, "then")
    if (then || "then" in value) throw fault(code)
  }
  return value
}

export function readCall(fn, tx, args, code = "async_silver_reader") {
  let active = true
  const check = () => { if (!active) throw fault("silver_reader_closed") }
  const read = (method, sql, params) => {
    check()
    // Deliberately narrow trusted-server query contract, not a SQL parser:
    // one bounded SELECT only; no comments, batches, CTEs, pragmas or writes.
    if (typeof sql !== "string" || sql.length > 16_384 || !/^\s*select\s/i.test(sql) || /;|--|\/\*|\bpragma\w*|\b(insert|update|delete|replace|attach|detach|vacuum|create|drop|alter|reindex|analyze|begin|commit|rollback|savepoint|release|returning|load_extension|writefile|readfile|eval)\b/i.test(sql) || params.length > 512 || params.some((p) => p !== null && !["string", "number", "bigint"].includes(typeof p))) throw fault("silver_reader_query_refused")
    return tx[method](sql, ...params)
  }
  const target = Object.freeze(Object.assign(Object.create(null), {
    get: (sql, ...params) => read("get", sql, params),
    all: (sql, ...params) => read("all", sql, params),
  }))
  const facade = new Proxy(target, {
    get(_target, key) {
      check()
      if (key === "depth") return tx.depth
      if (key === "get" || key === "all") return target[key]
      throw fault("silver_reader_readonly")
    },
    set() { check(); throw fault("silver_reader_readonly") },
  })
  let answer
  try { answer = Reflect.apply(fn, undefined, [facade, ...args]) }
  catch (error) { throw readerFault(error) ? error : fault("silver_reader_failed") }
  finally { active = false; tx = null }
  return syncValue(answer, code)
}
