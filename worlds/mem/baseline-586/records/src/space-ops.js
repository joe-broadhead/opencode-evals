/** Operator snapshots of a single records database. No store internals are used. */
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import * as sqlite from "node:sqlite"
import { invalid, conflict } from "./errors.js"
import { TRANSIENT_TABLES, migrate } from "./schema.js"

const { DatabaseSync } = sqlite

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")

function inspect(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    if (db.prepare("pragma integrity_check").get().integrity_check !== "ok") throw new Error("records database integrity check failed")
    const tables = db.prepare("select name from sqlite_schema where type = 'table' and name not like 'sqlite_%' order by name").all()
    const counts = {}
    let placement = {}
    let spaceKind = null
    let empty = true
    const hash = createHash("sha256")
    for (const { name } of tables) {
      // Keyed-write receipts are short-lived and left out of snapshots; a file
      // the store opened after an install gains the empty table.
      if (TRANSIENT_TABLES.includes(name)) continue
      // FTS shadow tables are included: they are part of the snapshot too.
      const quoted = `"${name.replaceAll('"', '""')}"`
      let rows = db.prepare(`select * from ${quoted}`).all()
      if (name === "meta") {
        placement = Object.fromEntries(rows.filter((row) => row.key === "team" || row.key === "service").map((row) => [row.key, row.value]))
        spaceKind = rows.find((row) => row.key === "space_kind")?.value ?? null
        // Placement is intentionally rewritten for the destination. All
        // other metadata and every data table remain in the content checksum.
        rows = rows.filter((row) => row.key !== "team" && row.key !== "service")
        // Build metadata is not content: the schema version, the kind, and the
        // migration digest (plan §4) leave an otherwise empty space empty.
        if (rows.some((row) => !["schema_version", "space_kind", "additive_digest"].includes(row.key))) empty = false
      } else if (!name.startsWith("records_fts_") && rows.length > 0) {
        empty = false
      }
      const encoded = rows.map((row) => JSON.stringify(row)).sort()
      counts[name] = rows.length
      hash.update(JSON.stringify([name, encoded]))
    }
    if (!["meta", "records", "versions", "links", "events"].every((name) => name in counts)) {
      throw new Error("records database schema is incomplete")
    }
    return { counts, content_sha256: hash.digest("hex"), placement, space_kind: spaceKind, empty }
  } finally { db.close() }
}

/** Update routing metadata on an already installed, quiescent database. */
export function retargetSpace(store, space, actor) {
  store.forSpace(space)
  const file = path.join(store.spacesDir, `${space}.db`)
  if (!fs.existsSync(file)) throw conflict("space_missing", "The records database does not exist.", "Install the verified snapshot first.")
  const db = new DatabaseSync(file)
  try {
    db.exec("pragma busy_timeout = 5000; begin immediate")
    try {
      const set = db.prepare("insert into meta(key, value) values (?, ?) on conflict(key) do update set value = excluded.value")
      set.run("team", actor.team)
      set.run("service", actor.service)
      db.exec("commit")
    } catch (error) { db.exec("rollback"); throw error }
  } finally { db.close() }
  return { team: actor.team, service: actor.service }
}

function workdir(store) {
  fs.mkdirSync(store.dataDir, { recursive: true, mode: 0o700 })
  return fs.mkdtempSync(path.join(store.dataDir, ".space-ops-"))
}

/** Only for a newly generated space ID, before its first placement exists. */
export function initializeSpace(store, space, actor) {
  store.forSpace(space)
  const dir = workdir(store)
  try {
    const temporary = path.join(dir, "new.db")
    const db = new DatabaseSync(temporary)
    try {
      migrate(db)
      const set = db.prepare("insert into meta(key, value) values (?, ?)")
      for (const [key, value] of [["team", actor.team], ["service", actor.service], ["space_kind", actor.spaceKind]]) set.run(key, value)
    } finally { db.close() }
    fs.chmodSync(temporary, 0o600)
    const fd = fs.openSync(temporary, "r")
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.mkdirSync(store.spacesDir, { recursive: true, mode: 0o700 })
    const target = path.join(store.spacesDir, `${space}.db`)
    if (["-wal", "-shm", "-journal"].some((suffix) => fs.existsSync(`${target}${suffix}`))) throw conflict("target_sidecars", "The target has SQLite sidecars.", "Investigate this space before retrying.")
    try { fs.linkSync(temporary, target) } catch (error) {
      if (error.code === "EEXIST") throw conflict("space_exists", "The records database already exists.", "Investigate this space before retrying.")
      throw error
    }
    const dirFd = fs.openSync(store.spacesDir, "r")
    try { fs.fsyncSync(dirFd) } finally { fs.closeSync(dirFd) }
    return { created: true }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

/** SQLite's online backup includes committed WAL frames; raw sidecars are not copied. */
export async function snapshotSpace(store, space, { includeData = true, backupImpl = sqlite.backup } = {}) {
  store.forSpace(space) // validates the identifier without creating a database
  const file = path.join(store.spacesDir, `${space}.db`)
  if (!fs.existsSync(file)) {
    if (["-wal", "-shm", "-journal"].some((suffix) => fs.existsSync(`${file}${suffix}`))) throw new Error("records database is missing but SQLite sidecars remain")
    return { exists: false }
  }
  const dir = workdir(store)
  const copy = path.join(dir, "snapshot.db")
  try {
    const source = new DatabaseSync(file, { readOnly: true })
    try {
      // node:sqlite.backup was added after the repository's Node 22.13 floor.
      // VACUUM INTO is SQLite's consistent online snapshot on older nodes.
      if (typeof backupImpl === "function") await backupImpl(source, copy)
      else source.prepare("vacuum into ?").run(copy)
    } finally { source.close() }
    // A snapshot carries no keyed-write receipts, so 0.9.3 cells agree on its
    // content. An older service's snapshot keeps the table and counts it, so
    // 0.9.3 refuses it: take snapshots on 0.9.3 (docs/design/records-idempotency.md).
    const scratch = new DatabaseSync(copy)
    try {
      for (const name of TRANSIENT_TABLES) scratch.exec(`drop table if exists "${name}"`)
    } finally { scratch.close() }
    const info = inspect(copy)
    if (!includeData) return { exists: true, space, ...info }
    const data = fs.readFileSync(copy)
    // The HTTP install route has a bounded JSON envelope; never create an
    // archive that this version of the destination cannot receive.
    if (data.length > 95 * 1024 * 1024) throw new Error("records snapshot exceeds the 95 MiB transfer limit")
    return { exists: true, space, sha256: digest(data), bytes: data.length, ...info, data: data.toString("base64") }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

/** Install only into an absent file, never overwriting a live or divergent copy. */
export async function installSpace(store, space, input) {
  store.forSpace(space)
  if (input?.space !== space || typeof input.data !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256 ?? "")) {
    throw invalid("invalid_snapshot", "The snapshot does not name this space or a valid checksum.", "Send the original snapshot and its space id.")
  }
  const data = Buffer.from(input.data, "base64")
  if (digest(data) !== input.sha256 || data.length !== input.bytes) {
    throw invalid("invalid_snapshot", "The snapshot checksum or size does not match.", "Send the unchanged snapshot.")
  }
  const dir = workdir(store)
  try {
    const temporary = path.join(dir, "snapshot.db")
    const fd = fs.openSync(temporary, "wx", 0o600)
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    const info = inspect(temporary)
    if (info.content_sha256 !== input.content_sha256 || JSON.stringify(info.counts) !== JSON.stringify(input.counts)) {
      throw invalid("invalid_snapshot", "The snapshot content or counts do not match.", "Send the unchanged snapshot.")
    }
    fs.mkdirSync(store.spacesDir, { recursive: true, mode: 0o700 })
    const target = path.join(store.spacesDir, `${space}.db`)
    if (!fs.existsSync(target) && ["-wal", "-shm", "-journal"].some((suffix) => fs.existsSync(`${target}${suffix}`))) {
      throw conflict("target_sidecars", "The target has orphan SQLite sidecars; nothing was installed.", "Investigate and recover the target before retrying.")
    }
    try {
      fs.linkSync(temporary, target)
      if (digest(fs.readFileSync(target)) !== input.sha256) throw new Error("installed records database checksum differs")
      const dirFd = fs.openSync(store.spacesDir, "r")
      try { fs.fsyncSync(dirFd) } finally { fs.closeSync(dirFd) }
    } catch (error) {
      if (error.code !== "EEXIST") throw error
      const current = await snapshotSpace(store, space, { includeData: false })
      if (!current.exists || current.content_sha256 !== info.content_sha256 || JSON.stringify(current.counts) !== JSON.stringify(info.counts)) {
        throw conflict("target_not_empty", "The target records database differs; it was not overwritten.", "Choose an empty target or reconcile it before retrying.")
      }
    }
    return { installed: true, ...info }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
