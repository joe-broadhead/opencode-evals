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
//   }
//
// A world with a build command must have been built by the build under test: the runner stamps each build with that
// build's digest (.evals-world.json) and a world built by another build, or by hand, is stale.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { runToEnd } from "./sandbox.mjs"
import { sha256 } from "../util/canonical.mjs"

export const parseSeed = (seed) =>
  Object.fromEntries(
    String(seed ?? "")
      .split(/[\s,]+/)
      .filter((part) => part.includes("="))
      .map((part) => [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)]),
  )

const STAMP = ".evals-world.json"

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
      const result = await runToEnd("bash", ["-c", s.build], { cwd: dir, env: { ...caller, EVALS_WORLD_DIR: dir, EVALS_WORLD_ARM: arm?.dir ?? "" }, timeoutMs: 30 * 60_000 })
      if (result.code !== 0) throw new Error(`the world build failed (exit ${result.code}): ${result.stderr.slice(-400)}`)
      writeFileSync(join(dir, STAMP), `${JSON.stringify({ built_at: new Date().toISOString(), arm_sha256: arm?.sha256 ?? null, now: clock(spec().now) }, null, 1)}\n`)
    },
    async prepare({ sandbox, seed }) {
      const s = spec()
      if (s.home) cpSync(at(s.home), sandbox.home, { recursive: true, verbatimSymlinks: true, force: true })
      const key = parseSeed(seed).cwd ?? s.default_cwd ?? null
      if (!key || !s.repos) {
        mkdirSync(join(sandbox.project, ".git"), { recursive: true })
        return { cwd: sandbox.project }
      }
      const name = s.cwd?.[key] ?? key
      const source = join(at(s.repos), name)
      if (!existsSync(source)) throw new Error(`the world has no repository ${name} (seed cwd=${key})`)
      // The agent works in its own copy, with the same .git (so the same project id): one run cannot touch another's.
      const cwd = join(sandbox.root, "work", name)
      cpSync(source, cwd, { recursive: true, verbatimSymlinks: true })
      return { cwd }
    },
    provenance() {
      const s = spec()
      return { name: this.name, now: clock(s.now), world_sha256: sha256(readFileSync(file, "utf8")), built: stamp() }
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
