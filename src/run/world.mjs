// The world a case runs in: what is in the sandbox's home (a seeded OpenCode database, a plugin's own index), and
// the directory the agent works in. A plugin whose cases need data brings a world; the rest run in an empty project.
//
// A world is one of:
//   (nothing)      an empty project directory
//   DIR            a directory holding world.json (below)
//   FILE.mjs       a module whose default export is { name, status(ctx), build(ctx)?, prepare(ctx), provenance()? }
//
// world.json, every path relative to the world directory unless absolute:
//   {
//     "home":  "gold/home",                 copied over each sandbox home
//     "repos": "repos",                     working directories; a case's `Seed: cwd=<key>` picks one
//     "cwd":   { "api": "lumen-api" },      aliases for seed values, and "default_cwd": "api"
//     "now":   1794265556400 | "truth.json#now",   the world's clock, in ms
//     "fresh": "utc-day" | "24h" | "always",       how long a build stays valid (default "always")
//     "build": "./make-gold.sh"             rebuilds the world; run with EVALS_WORLD_ARM set to the build under test
//     "overlay": "$EVALS_STORE/holdouts/history/world",   a private add-on the build receives as EVALS_WORLD_OVERLAY
//     "prepare": "./fix-paths.sh",          run per sandbox after the copy (EVALS_SANDBOX_HOME, EVALS_RUN_CWD,
//                                           EVALS_REPO_SOURCE): rewrite recorded directories to the run's own
//     "truth": "world/truth.json",          what the build derived; a case's `Truth:` claims are checked against it
//     "sessions": { "earlier": "ses_…" }    sessions a case continues with `Seed: continue=earlier`; or a reference to a
//                                           map the build writes, "world/truth.json#ids"
//   }
//
// A case's Seed picks within the world: `cwd=<key>` the repository, `subdir=<a/b>` a folder inside its copy (it must
// exist once the world's prepare has run, and is never a link), `continue=<key>` a session to continue.
//
// A world with a build command must have been built by the build under test: the runner stamps each build with that
// build's digest (.evals-world.json) and a world built by another build, or by hand, is stale.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync, statSync } from "node:fs"
import { dirname } from "node:path"
import { isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { runToEnd } from "./sandbox.mjs"
import { sha256 } from "../util/canonical.mjs"
import { treeDigest } from "./arm.mjs"
import { segment, within, inside } from "./paths.mjs"
import { tail } from "./secrets.mjs"

/** A digest of a file or a directory tree: what records which private overlay a world was built with. */
const digestOfPath = (path) => (statSync(path).isDirectory() ? treeDigest(path) : sha256(readFileSync(path)))

export const parseSeed = (seed) =>
  Object.fromEntries(
    String(seed ?? "")
      .split(/[\s,]+/)
      .filter((part) => part.includes("="))
      .map((part) => [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)]),
  )

const STAMP = ".evals-world.json"

/** The first symlink under `dir` that points outside `root`, as a path relative to `dir`, or null. */
function linkOutOf(dir, root) {
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isSymbolicLink()) {
        const target = resolve(dirname(path), readlinkSync(path))
        if (!inside(root, target)) return path.slice(dir.length + 1)
      } else if (entry.isDirectory()) {
        const found = walk(path)
        if (found) return found
      }
    }
    return null
  }
  return walk(dir)
}

/** Is a world clock still valid now? */
export function freshness(rule, now, at = Date.now()) {
  if (!rule || rule === "always") return { fresh: true }
  if (typeof now !== "number") return { fresh: false, why: "the world has no clock (`now`), so its freshness cannot be checked" }
  if (rule === "utc-day") {
    const built = new Date(now).toISOString().slice(0, 10)
    const today = new Date(at).toISOString().slice(0, 10)
    return built === today ? { fresh: true } : { fresh: false, why: `the world was built for ${built} (UTC) and it is ${today}` }
  }
  const hours = /^(\d+)h$/.exec(rule)
  if (hours) {
    const age = (at - now) / 3_600_000
    return age <= Number(hours[1]) ? { fresh: true } : { fresh: false, why: `the world is ${age.toFixed(1)} h old, more than ${hours[1]} h` }
  }
  throw new Error(`unknown world freshness ${JSON.stringify(rule)}: use utc-day, <n>h or always`)
}

/** The empty world: a project directory with a .git, so discovery stops there and reads nothing of the machine. */
export const emptyWorld = () => ({
  name: "empty",
  status: () => ({ fresh: true }),
  async prepare({ sandbox }) {
    mkdirSync(join(sandbox.project, ".git"), { recursive: true })
    return { cwd: sandbox.project }
  },
  provenance: () => ({ name: "empty" }),
})

/** A world described by a world.json. */
export function dirWorld(dir) {
  const file = join(dir, "world.json")
  if (!existsSync(file)) throw new Error(`no world.json in ${dir}`)
  const at = (path) => (isAbsolute(path) ? path : resolve(dir, path))
  const spec = () => JSON.parse(readFileSync(file, "utf8"))
  const clock = (value) => {
    if (typeof value === "number") return value
    if (typeof value === "string" && value.includes("#")) {
      const [path, key] = value.split("#")
      const data = JSON.parse(readFileSync(at(path), "utf8"))
      const found = key.split(".").reduce((node, part) => node?.[part], data)
      return typeof found === "number" ? found : Date.parse(found)
    }
    return typeof value === "string" ? Date.parse(value) : null
  }
  const stamp = () => (existsSync(join(dir, STAMP)) ? JSON.parse(readFileSync(join(dir, STAMP), "utf8")) : null)
  // `$VAR` in a path is the caller's variable: an overlay lives in the private store, never beside the world.
  const expand = (path, env) => String(path).replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name) => env[name] ?? "")
  const overlayOf = (s, env = process.env) => (s.overlay ? at(expand(s.overlay, env)) : null)
  // The world's sessions: a map in world.json, or "file#path" naming one the build wrote (session ids it derives).
  const sessionsOf = (s) => {
    if (typeof s.sessions !== "string") return s.sessions ?? {}
    const [path, key = ""] = s.sessions.split("#")
    const data = JSON.parse(readFileSync(at(path), "utf8"))
    const found = key ? key.split(".").reduce((node, part) => node?.[part], data) : data
    if (!found || typeof found !== "object") throw new Error(`the world's sessions ${s.sessions} name no map`)
    return found
  }
  return {
    name: dir.split(/[\\/]/).filter(Boolean).pop(),
    status({ arm, at: now = Date.now() } = {}) {
      const s = spec()
      const worldNow = clock(s.now)
      const fresh = freshness(s.fresh, worldNow, now)
      if (!fresh.fresh) return { ...fresh, now: worldNow, rebuildable: Boolean(s.build) }
      if (s.build && arm?.sha256) {
        const built = stamp()
        if (!built) return { fresh: false, now: worldNow, rebuildable: true, why: "the world was not built by `evals run`, so the build that indexed it is unknown" }
        if (built.arm_sha256 !== arm.sha256) return { fresh: false, now: worldNow, rebuildable: true, why: `the world was built by another build (${String(built.arm_sha256).slice(0, 12)}), not the one under test (${arm.sha256.slice(0, 12)})` }
      }
      return { fresh: true, now: worldNow }
    },
    async build({ arm, caller = process.env, log = () => {} }) {
      const s = spec()
      if (!s.build) throw new Error(`${file} has no build command`)
      log(`world: rebuilding with ${s.build}`)
      const overlay = overlayOf(s, caller)
      if (overlay && !existsSync(overlay)) throw new Error(`the world's overlay ${s.overlay} is not there`)
      const result = await runToEnd("bash", ["-c", s.build], { cwd: dir, env: { ...caller, EVALS_WORLD_DIR: dir, EVALS_WORLD_ARM: arm?.dir ?? "", EVALS_WORLD_OVERLAY: overlay ?? "" }, timeoutMs: 30 * 60_000 })
      if (result.code !== 0) throw new Error(`the world build failed (exit ${result.code}): ${tail(result.stderr, 400)}`)
      writeFileSync(join(dir, STAMP), `${JSON.stringify({ built_at: new Date().toISOString(), arm_sha256: arm?.sha256 ?? null, overlay_sha256: overlay ? digestOfPath(overlay) : null, now: clock(spec().now) }, null, 1)}\n`)
    },
    async prepare({ sandbox, seed, caller = process.env }) {
      const s = spec()
      const seeds = parseSeed(seed)
      if (s.home) cpSync(at(s.home), sandbox.home, { recursive: true, verbatimSymlinks: true, force: true })
      const key = seeds.cwd ?? s.default_cwd ?? null
      let cwd = sandbox.project
      let source = null
      if (!key || !s.repos) mkdirSync(join(sandbox.project, ".git"), { recursive: true })
      else {
        // A seed key and the repository it names are single names inside the world's repos: never a path.
        segment("Seed cwd", key)
        const name = segment(`the world's repository for cwd=${key}`, s.cwd?.[key] ?? key)
        source = within(at(s.repos), join(at(s.repos), name), "the seeded repository")
        // A repository that is a link, or holds a link out of the world, would carry the run outside: refused.
        if (lstatSync(source).isSymbolicLink()) throw new Error(`the world's repository ${name} is a symbolic link: refusing it`)
        const escape = linkOutOf(source, dir)
        if (escape) throw new Error(`the world's repository ${name} holds a link out of the world (${escape}): refusing it`)
        if (!existsSync(source)) throw new Error(`the world has no repository ${name} (seed cwd=${key})`)
        // The agent works in its own copy, with the same .git (so the same project id): one run cannot touch another's.
        cwd = within(sandbox.root, join(sandbox.root, "work", name), "the working directory")
        cpSync(source, cwd, { recursive: true, verbatimSymlinks: true })
      }
      // A world whose sessions record directories rewrites them to this run's own, so `scope: directory` still means
      // something in a copy.
      if (s.prepare) {
        const result = await runToEnd("bash", ["-c", s.prepare], { cwd: dir, env: { ...caller, EVALS_WORLD_DIR: dir, EVALS_SANDBOX_ROOT: sandbox.root, EVALS_SANDBOX_HOME: sandbox.home, EVALS_RUN_CWD: cwd, EVALS_REPO_SOURCE: source ?? "" }, timeoutMs: 5 * 60_000 })
        if (result.code !== 0) throw new Error(`the world's prepare step failed (exit ${result.code}): ${tail(result.stderr, 300)}`)
      }
      // `subdir=<a/b>`: the run starts in a folder of its copy, each part a safe name, nothing on the way a link.
      if (seeds.subdir) {
        if (!source) throw new Error(`Seed subdir=${seeds.subdir} needs a repository (cwd=<key>)`)
        let at = cwd
        for (const part of seeds.subdir.split("/").filter(Boolean)) {
          at = within(sandbox.root, join(at, segment("Seed subdir part", part)), "the working directory")
          if (!existsSync(at) || lstatSync(at).isSymbolicLink() || !lstatSync(at).isDirectory()) throw new Error(`Seed subdir=${seeds.subdir}: ${part} is not a folder of the repository's copy`)
        }
        cwd = at
      }
      let session = null
      if (seeds.continue) {
        segment("Seed continue", seeds.continue)
        session = sessionsOf(s)[seeds.continue] ?? null
        if (!session) throw new Error(`the world has no session ${JSON.stringify(seeds.continue)} to continue (world.json "sessions")`)
      }
      return { cwd, session }
    },
    /** The world's truth file, parsed, or null when it names none. */
    truth() {
      const s = spec()
      if (!s.truth) return null
      if (!existsSync(at(s.truth))) throw new Error(`the world's truth ${s.truth} is not there: build the world first`)
      return JSON.parse(readFileSync(at(s.truth), "utf8"))
    },
    provenance() {
      const s = spec()
      const built = stamp()
      return { name: this.name, now: clock(s.now), world_sha256: sha256(readFileSync(file, "utf8")), built, ...(built?.overlay_sha256 ? { overlay_sha256: built.overlay_sha256 } : {}) }
    },
  }
}

/** Loads the world named by --world (a directory or a module), or the empty world. */
export async function loadWorld(spec) {
  if (!spec) return emptyWorld()
  if (!existsSync(spec)) throw new Error(`no world at ${spec}`)
  if (statSync(spec).isDirectory()) return dirWorld(resolve(spec))
  const module = await import(pathToFileURL(resolve(spec)).href)
  const world = module.default ?? module
  for (const fn of ["status", "prepare"]) if (typeof world[fn] !== "function") throw new Error(`${spec}: a world module exports ${fn}()`)
  return { name: world.name ?? "module", provenance: () => ({ name: world.name ?? "module" }), ...world }
}
