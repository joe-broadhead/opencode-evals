// Owner-side owned capability for the wave's matched-binding path.
// Composed only from reviewed modules and supplied by the run script when — and only
// when — the dispatch-time native qualification binding reports a match. Without a match
// the frozen default {snapshot:null, spawn:null} stays and admission refuses as today.
// No environment or manifest boolean substitutes for the matched binding, no credential
// beyond OPENCODE_API_KEY exists, and no Docker context or configuration is created,
// switched or mutated here: the dispatch task owns the wave's own configuration directory.
import { spawn as spawnProcess } from "node:child_process"
import * as fs from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { OWNED_CONTEXT } from "./owned-containment.mjs"
import { validateOwnedInputs } from "./owned-io.mjs"
import { sha256 } from "./wave-manifest.mjs"

const canonical = path => typeof path === "string" && isAbsolute(path) && resolve(path) === path
const refuse = fact => { throw new Error(`snapshot-unverified:${fact}`) }

/** The owner hands the staged tuple's facts through the wave manifest's `staging` pin:
 * { work, inputs, binaries, image, architecture, imageEnv, user, allow }. The
 * attestation records only what it can verify at call time: the selected arm's staged
 * tarball is re-hashed against its manifest pin, the staged work/inputs/binaries trees
 * are re-hashed through the reviewed staging validator, and the handed image identity
 * must equal the manifest's pinned runtime image. A missing, tampered or unverifiable
 * fact refuses admission with a closed snapshot-unverified reason; no partial or
 * invented attestation and no success authority is ever returned. The returned tuple
 * carries staged facts only — nothing about trial outcomes.
 */
export function createOwnedCapability(wave, native, manifestSha, { spawn = spawnProcess, io = fs, readFile = fs.readFileSync } = {}) {
  if (native?.matched !== true || !native.identityOwner) throw new Error("native dispatch refused: qualification binding absent")
  const staging = wave?.staging
  return Object.freeze({
    // The real Docker-CLI spawn primitive. The reviewed transport in wave-contained
    // (createOwnedDockerProcess feeding createOwnedDockerClient) composes this leaf with
    // the matched binding's identityOwner, the fixed approved context and the
    // OPENCODE_API_KEY-only credential shape; this leaf never touches the caller's
    // environment, context or configuration.
    spawn(file, args, options) {
      if (native.matched !== true || !native.identityOwner) throw new Error("owned-capability-spawn-refused")
      if (!Array.isArray(args) || args[0] !== "--context" || args[1] !== OWNED_CONTEXT) throw new Error("owned-capability-spawn-refused")
      return spawn(file, args, options)
    },
    snapshot(request) {
      if (request?.manifestSha !== manifestSha) refuse("manifest")
      if (request?.harnessSha !== wave.harness_sha) refuse("harness")
      const trial = wave.trials?.find(t => t?.id === request.trial?.id && t.arm === request.trial.arm && t.condition === request.trial.condition)
      if (!trial) refuse("trial")
      const stagingShape = canonical(staging?.work) && canonical(staging?.inputs) && canonical(staging?.binaries)
        && ["arm64", "x64"].includes(staging.architecture)
        && Array.isArray(staging.imageEnv) && staging.imageEnv.length === 1
        && /^[1-9][0-9]*:[1-9][0-9]*$/.test(staging.user ?? "")
        && Array.isArray(staging.allow) && staging.allow.length
      if (!stagingShape) refuse("staging")
      if (staging.image !== wave.runtime?.image) refuse("image")
      const archive = wave.arms?.[trial.arm]?.archive
      if (!canonical(archive?.path) || !/^[a-f0-9]{64}$/.test(archive.sha256 ?? "")) refuse("arm-archive")
      let bytes
      try { bytes = readFile(archive.path) } catch { refuse("arm-archive") }
      if (sha256(bytes) !== archive.sha256) refuse("arm-archive")
      let proof
      try {
        proof = validateOwnedInputs({ work: staging.work, inputs: staging.inputs, binaries: staging.binaries, architecture: staging.architecture, descriptor: { options: { condition: trial.condition } } }, io)
      } catch { refuse("staged-trees") }
      return {
        manifest_sha256: request.manifestSha, harness_sha: request.harnessSha, trial_id: trial.id,
        image: staging.image, work: staging.work, inputs: staging.inputs, binaries: staging.binaries,
        architecture: staging.architecture, inputs_sha256: proof.inputs_sha256, binaries_sha256: proof.binaries_sha256,
        imageEnv: [...staging.imageEnv], user: staging.user, allow: [...staging.allow],
      }
    },
  })
}
