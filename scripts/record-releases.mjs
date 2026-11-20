#!/usr/bin/env node
// Records, in each pack, the release it describes: `release: { version, tag, commit }` (the commit the tag points at). `evals pack --sync --release <versions>` does it for the packs it syncs;
// this does it for the packs already committed, from the checkouts EVALS_COMPANIONS (id -> a git checkout or build of the plugin) or EVALS_REPO_<ID> name.
//   node scripts/record-releases.mjs           writes packs/<id>/pack.json   |   --check  fails when a pack records none, or a different commit

import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { releaseInfo } from "../src/pack/release.mjs"
import { writeSnapshot } from "../src/pack/snapshot.mjs"
import { loadPacks } from "../src/run/lockdown.mjs"

const ROOT = resolve(import.meta.dirname, "..")
const check = process.argv.includes("--check")
const companions = process.env.EVALS_COMPANIONS && existsSync(process.env.EVALS_COMPANIONS) ? JSON.parse(readFileSync(process.env.EVALS_COMPANIONS, "utf8")) : {}
let bad = 0
for (const pack of loadPacks()) {
  const entry = companions[pack.id]
  const repo = process.env[`EVALS_REPO_${pack.id.toUpperCase()}`] ?? (typeof entry === "string" ? entry : entry?.package)
  const wanted = repo ? releaseInfo({ repo, version: pack.version }) : null
  const have = pack.release ?? null
  if (check) {
    if (!have?.tag || !have.commit || have.version !== pack.version || have.tag !== `v${pack.version}`) { console.error(`${pack.id}: records no release (version ${pack.version}, tag v${pack.version}, commit)`); bad++ }
    else if (wanted?.commit && wanted.commit !== have.commit) { console.error(`${pack.id}: records ${have.commit.slice(0, 7)} for ${have.tag}, the checkout's tag is ${wanted.commit.slice(0, 7)}`); bad++ }
    continue
  }
  if (!wanted?.commit) { console.error(`${pack.id}: no checkout holds tag v${pack.version}`); bad++; continue }
  writeSnapshot(ROOT, { ...pack, release: wanted })
  console.log(`${pack.id}: v${pack.version} ${wanted.commit.slice(0, 7)}`)
}
if (bad) process.exit(1)
