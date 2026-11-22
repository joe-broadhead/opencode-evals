/**
 * One small adapter so the claims modules take either the store's own handle
 * (which already has `run`, `get`, `all` and `tx`) or a `node:sqlite` database
 * opened on a space file. The routines pass the store's handle, so a batch
 * files its claims in the write's own transaction.
 */
function wrap(db) {
  const statements = new Map()
  let depth = 0
  const stmt = (sql) => {
    let prepared = statements.get(sql)
    if (!prepared) {
      prepared = db.prepare(sql)
      statements.set(sql, prepared)
    }
    return prepared
  }
  const handle = {
    db,
    run(sql, ...params) {
      return stmt(sql).run(...params)
    },
    get(sql, ...params) {
      return stmt(sql).get(...params)
    },
    all(sql, ...params) {
      return stmt(sql).all(...params)
    },
    tx(fn) {
      if (depth > 0) {
        depth += 1
        try {
          return fn()
        } finally {
          depth -= 1
        }
      }
      db.exec("begin immediate")
      depth = 1
      try {
        const result = fn()
        db.exec("commit")
        return result
      } catch (error) {
        try {
          db.exec("rollback")
        } catch {
          // The transaction is already gone.
        }
        throw error
      } finally {
        depth = 0
      }
    },
  }
  return handle
}

/** @param {any} db a store handle, or a node:sqlite DatabaseSync */
export function claimHandle(db) {
  if (db && typeof db.run === "function" && typeof db.get === "function" && typeof db.all === "function") return db
  return wrap(db)
}
