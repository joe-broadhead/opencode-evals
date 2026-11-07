// Which bundle T1 grades: never the checkout's git-ignored `dist/` on faith.
//
// `dist/` is ignored by git, so nothing warns when it is older than the source: Metaview's was a day behind
// its declaration, and T1 graded a bundle that had one tool fewer than the pack described. The rule now is
// that a bundle is graded only if it is built from the *tracked* tree — either because the checkout's own
// `dist/` is provably newer than every tracked file, or because we build one from a copy of `HEAD` in a temp
// directory. The checkout itself is never written to.

import { existsSync, readdirSync, statSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, relative } from "node:path"

const newest = (dir, filter = () => true) => {
  let time = 0
  let file = null
  const walk = (at) => {
    if (!existsSync(at)) return
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (filter(path)) {
        const mtime = statSync(path).mtimeMs
        if (mtime > time) {
          time = mtime
          file = path
        }
      }
    }
  }
  walk(dir)
  return { time, file }
}

const git = (repo, args) => execFileSync("/usr/bin/git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })

/** When the tracked tree last changed: the newest working-tree mtime, capped by the commit time. */
export function trackedTime(repo) {
  const source = newest(join(repo, "src"), (path) => /\.(ts|tsx|js|json)$/.test(path))
  const skills = newest(join(repo, "skills"))
  const pkg = existsSync(join(repo, "package.json")) ? statSync(join(repo, "package.json")).mtimeMs : 0
  let commit = 0
  let head = null
  try {
    head = git(repo, ["rev-parse", "HEAD"]).trim()
    commit = Number(git(repo, ["log", "-1", "--format=%ct", "HEAD"]).trim()) * 1000
  } catch {
    head = null
  }
  return { time: Math.max(source.time, skills.time, pkg, commit), file: source.file ?? skills.file ?? "package.json", head, commit }
}

/**
 * @returns {{ok: boolean, dir?: string, bundled?: string, why?: string, built?: boolean, head?: string, stale?: object}}
 */
export function bundleFor(repo, into) {
  const tracked = trackedTime(repo)
  const dist = join(repo, "dist", "index.js")
  const distTime = existsSync(dist) ? statSync(dist).mtimeMs : 0

  if (!existsSync(dist)) return { ok: false, why: `no dist/index.js in ${repo}`, stale: { tracked: tracked.time, dist: null } }

  if (distTime >= tracked.time) {
    return { ok: true, dir: repo, built: false, head: tracked.head, stale: { tracked: tracked.time, dist: distTime, stale: false } }
  }

  // The bundle is older than the tree it claims to build. Build from a copy of HEAD: the checkout stays
  // read-only, and what is graded is the tracked state the pack describes.
  try {
    mkdirSync(into, { recursive: true })
    // `git archive` writes a tar, so it goes to a file: reading it as text corrupts it.
    const tarball = join(into, ".head.tar")
    git(repo, ["archive", "--format=tar", `--output=${tarball}`, "HEAD"])
    execFileSync("/usr/bin/tar", ["-xf", tarball, "-C", into], { stdio: ["ignore", "ignore", "ignore"] })
    unlinkSync(tarball)
    if (existsSync(join(repo, "node_modules")) && !existsSync(join(into, "node_modules"))) {
      // A link, not a copy: the checkout's installed dependencies are read-only inputs to the build.
      symlinkSync(join(repo, "node_modules"), join(into, "node_modules"), "dir")
    }
    const build = execFileSync(process.execPath, [join(into, "scripts", "build.mjs")], { cwd: into, stdio: ["ignore", "pipe", "pipe"], timeout: 240000 })
    void build
    if (!existsSync(join(into, "dist", "index.js"))) throw new Error("the build produced no dist/index.js")
    return { ok: true, dir: into, built: true, head: tracked.head, stale: { tracked: tracked.time, dist: distTime, stale: true } }
  } catch (error) {
    const detail = [error?.message, error?.stderr ? String(error.stderr).slice(0, 200) : null].filter(Boolean).join(" | ")
    return {
      ok: false,
      why: `dist/index.js is older than the tracked tree (${new Date(distTime).toISOString()} < ${new Date(tracked.time).toISOString()}) and a build from HEAD failed: ${String(detail).slice(0, 300)}`,
      stale: { tracked: tracked.time, dist: distTime, stale: true },
      head: tracked.head,
    }
  }
}
