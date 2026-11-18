// A pack from a RELEASE, not from a checkout's master (EVALS-232): the plugin's tagged source, extracted with `git archive`,
// is what `derivePack` reads, so a pack describes the version the round installs, whatever the checkout has moved on to.

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The versions to sync to: a JSON map `{ "slack": "0.0.6" }`, or a shell file with `[slack]=0.0.6` pairs (the family's
 * upgrade script holds them that way). A `v` prefix is allowed.
 */
export function readVersions(file) {
  const text = readFileSync(file, "utf8")
  try {
    const data = JSON.parse(text)
    return Object.fromEntries(Object.entries(data).map(([id, version]) => [id, String(version).replace(/^v/, "")]))
  } catch {
    const out = {}
    for (const m of text.matchAll(/\[([a-z][a-z0-9-]*)\]=v?(\d+\.\d+\.\d+)/g)) out[m[1]] = m[2]
    if (!Object.keys(out).length) throw new Error(`${file} holds no \`[id]=x.y.z\` pairs and is not JSON`)
    return out
  }
}

/** Extracts one release tag of a checkout into `into/<id>@<version>` with `git archive`; returns the directory. */
export function extractRelease({ id, version, repo, into, fetch = false }) {
  if (!repo || !existsSync(join(repo, ".git"))) throw new Error(`${id}: no git checkout at ${repo ?? "(unset)"} to read tag v${version} from`)
  const git = (args) => execFileSync("git", ["-C", repo, ...args], { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
  if (fetch) {
    try {
      git(["fetch", "--tags", "--quiet", "origin"])
    } catch (error) {
      throw new Error(`${id}: could not fetch tags: ${String(error.stderr ?? error.message).trim().slice(0, 160)}`)
    }
  }
  const tag = `v${version}`
  try {
    git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`])
  } catch {
    throw new Error(`${id}: tag ${tag} is not in ${repo} (fetch the tags: --fetch)`)
  }
  const dir = join(into, `${id}@${version}`)
  mkdirSync(dir, { recursive: true })
  const archive = git(["archive", "--format=tar", tag])
  const unpack = spawnSync("tar", ["-x", "-C", dir], { input: archive, maxBuffer: 1024 * 1024 * 1024 })
  if (unpack.status !== 0) throw new Error(`${id}: could not unpack ${tag}: ${String(unpack.stderr).slice(0, 160)}`)
  return dir
}
