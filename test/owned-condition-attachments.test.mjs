// Regression for dispatch BLOCKER 4: the owned composition's in-container condition
// proof re-reads dossier attachments pinned at HOST-canonical paths, which the
// container cannot see (its mounts are /inputs, /opt/evals/bin, /work; no absolute
// path is valid on both sides). The reviewed path seam: the pins keep their
// host-canonical paths and sha256 values; the owned proof resolves each attachment
// by BASENAME beneath the container root /inputs/attachments, hash-bound to the
// pin's own sha; the legacy host-side proof keeps resolving the pin's own path.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { qualifyConditions, OWNED_CONDITION_ATTACHMENTS } from "../src/run/wave-manifest.mjs"
import { validateOwnedInputs as stagingInputs } from "../src/run/owned-io.mjs"

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex")

// A complete oc-mem-conditions/1 dossier whose observation pins are recorded at
// host-canonical paths under `hostBase` — a directory that never exists in this
// environment — while basename copies carrying the same shas live under `root`.
function dossierFixture(t, { hostBase, root }) {
  const q = { schema: "oc-mem-conditions/1", mapping: "execute-permission-v1", status: "qualified", model: "opencode/deepseek-v4.1-flash#low",
    runtime_sha256: "1".repeat(64), archive_sha256: "2".repeat(64), memory_tool_ids: ["mem_recall", "mem_wiki"], observations: {} }
  const bodies = {}
  for (const condition of ["direct", "search"]) {
    bodies[`${condition}-config.json`] = JSON.stringify({ permissions: [{ action: "execute", resource: "*", effect: condition === "direct" ? "deny" : "allow" }] })
    bodies[`${condition}-catalog.json`] = JSON.stringify([{ id: "mem_recall" }, { id: "mem_wiki" }])
    bodies[`${condition}-request.json`] = JSON.stringify({ tools: (condition === "direct" ? ["mem_recall", "mem_wiki"] : ["execute", "search"]).map(name => ({ type: "function", function: { name } })) })
  }
  for (const [name, text] of Object.entries(bodies)) writeFileSync(join(root, name), Buffer.from(text))
  for (const condition of ["direct", "search"]) {
    q.observations[condition] = {}
    for (const kind of ["config", "catalog", "request"]) {
      const name = `${condition}-${kind}.json`
      q.observations[condition][kind] = { path: join(hostBase, name), sha256: sha256(Buffer.from(bodies[name])) }
    }
  }
  return { q, identity: { runtime_sha256: q.runtime_sha256, archive_sha256: q.archive_sha256, model: q.model } }
}

test("the owned proof resolves host-pinned attachments by basename and sha beneath the container root", t => {
  const root = mkdtempSync(join(tmpdir(), "owned-attachments-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const attachments = join(root, "attachments")
  mkdirSync(attachments)
  const hostBase = join(root, "host-staging", "dossiers", "conditions", "baseline") // never created: host-only paths
  const { q, identity } = dossierFixture(t, { hostBase, root: attachments })
  assert.equal(OWNED_CONDITION_ATTACHMENTS, "/inputs/attachments", "the owned composition's documented root")
  const proof = qualifyConditions(q, identity, attachments)
  assert.equal(proof.mapping, "execute-permission-v1")
  // The dossier's recorded host pins never resolved; the root copies did, by hash.
  for (const condition of ["direct", "search"]) for (const kind of ["config", "catalog", "request"]) {
    assert.equal(q.observations[condition][kind].path.startsWith(hostBase), true, "the host pins are unchanged")
  }
})

test("a missing, tampered, renamed or non-plain-name attachment refuses fail-closed", t => {
  const canonical = "file pin must be a canonical regular file without symlinks"
  const mismatch = "file pin digest mismatch"
  const build = () => {
    const root = mkdtempSync(join(tmpdir(), "owned-attachments-neg-"))
    const attachments = join(root, "attachments")
    mkdirSync(attachments)
    const hostBase = join(root, "host-staging", "dossiers", "x")
    return { root, attachments, hostBase, ...dossierFixture(t, { hostBase, root: attachments }) }
  }
  const cases = [
    // The pinned copy is absent from the resolution root.
    ["missing attachment", ({ attachments }) => { rmSync(join(attachments, "direct-config.json")); return { message: canonical } }],
    // The copy exists under the pinned basename but its bytes are not the pinned bytes.
    ["sha-tampered attachment", ({ attachments }) => { writeFileSync(join(attachments, "search-catalog.json"), Buffer.from("tampered")); return { message: mismatch } }],
    // The copy was substituted under another name: the pinned basename is missing.
    ["renamed attachment", ({ attachments }) => { writeFileSync(join(attachments, "direct-request-copy.json"), readFileSync(join(attachments, "direct-request.json"))); rmSync(join(attachments, "direct-request.json")); return { message: canonical } }],
    // Directory components in the recorded pin are neutralized by the basename
    // resolution: the refusal is the MISSING COPY at the neutralized name.
    ["path-laden pin neutralizes to its basename; the missing copy refuses", ({ q }) => { q.observations.direct.config = { path: "/host/../../escape.json", sha256: q.observations.direct.config.sha256 }; return { message: canonical } }],
    // A literally non-plain basename refuses at the name grammar before resolution.
    ["non-plain basename refuses at the name grammar", ({ q }) => { q.observations.direct.config = { path: "/host/.hidden.json", sha256: q.observations.direct.config.sha256 }; return { message: canonical } }],
    ["dot-segment basename refuses at the name grammar", ({ q }) => { q.observations.direct.config = { path: "/host/..", sha256: q.observations.direct.config.sha256 }; return { message: canonical } }],
  ]
  for (const [label, mutate] of cases) {
    const f = build()
    try {
      const { message } = mutate(f)
      assert.throws(() => qualifyConditions(f.q, f.identity, f.attachments), { message }, label)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }
  // A non-canonical resolution root refuses with the root-canonical message.
  const f = build()
  try {
    assert.throws(() => qualifyConditions(f.q, f.identity, "relative-attachments"), { message: "attachment resolution root must be canonical" }, "bad root")
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("the legacy host-side proof keeps resolving the pin's own canonical path", t => {
  const root = mkdtempSync(join(tmpdir(), "legacy-dossier-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  // Here the dossier's own directory exists and holds the attachments, exactly today.
  const { q, identity } = dossierFixture(t, { hostBase: root, root, materialise: true })
  const proof = qualifyConditions(q, identity)
  assert.equal(proof.status, "qualified")
  // And the same dossier under the owned root ALSO passes — one dossier, one hash
  // identity, two-sided resolution.
  const attachments = join(root, "attachments")
  mkdirSync(attachments)
  for (const condition of ["direct", "search"]) for (const kind of ["config", "catalog", "request"]) {
    const pin = q.observations[condition][kind]
    writeFileSync(join(attachments, pin.path.split("/").at(-1)), readFileSync(pin.path))
  }
  assert.equal(qualifyConditions(q, identity, attachments).status, "qualified")
})

test("the staged inputs tree admits the optional attachments root the owned proof reads", t => {
  // The owned staging validator (owned-io.mjs) admits the optional attachments root;
  // a mis-staged regular file at that name must surface at staging validation.
  const root = mkdtempSync(join(tmpdir(), "owned-staging-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const inputs = join(root, "inputs"), binaries = join(root, "binaries"), work = join(root, "work")
  mkdirSync(work); mkdirSync(binaries)
  for (const p of [inputs, join(inputs, "harness"), join(inputs, "arm"), join(inputs, "cases")]) mkdirSync(p)
  for (const name of ["caps.json", "models.json", "model-map.json", "conditions.json"]) writeFileSync(join(inputs, name), "{}")
  writeFileSync(join(inputs, "harness", "identity"), "synthetic harness")
  writeFileSync(join(inputs, "cases", "core-a.json"), "{}")
  const elf = Buffer.alloc(20); elf.write("\x7fELF"); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(183, 18)
  for (const name of ["node", "opencode"]) writeFileSync(join(binaries, name), elf, { mode: 0o700 })
  const base = { work, inputs, binaries, architecture: "arm64", descriptor: { options: { condition: "direct" } } }
  assert.doesNotThrow(() => stagingInputs(base))
  mkdirSync(join(inputs, "attachments"))
  writeFileSync(join(inputs, "attachments", "baseline-direct-config.json"), "{}")
  assert.doesNotThrow(() => stagingInputs(base), "an attachments directory is admissible staging")
  rmSync(join(inputs, "attachments"), { recursive: true })
  writeFileSync(join(inputs, "attachments"), "mis-staged regular file")
  assert.throws(() => stagingInputs(base), /minimal staged directories/, "a regular file at the attachments name refuses at staging validation")
  rmSync(join(inputs, "attachments"))
  writeFileSync(join(inputs, "foreign.json"), "unapproved")
  assert.throws(() => stagingInputs(base), /minimal staged roots/)
})

test("the runner threads the owned root only in contained mode", () => {
  const runner = readFileSync(new URL("../src/run/runner.mjs", import.meta.url), "utf8")
  const site = runner.indexOf("qualifyConditions(JSON.parse(readFileSync(options.conditionQualification")
  assert.ok(site > 0, "the condition-proof call site exists")
  // The offline suites cannot execute runner.mjs:1100–1102 inside a container; the
  // threading contract is pinned here and the in-container proof is the next
  // dispatch round's live evidence.
  const call = runner.slice(site, runner.indexOf(": null", site))
  assert.equal(call.includes("contained ? OWNED_CONDITION_ATTACHMENTS : undefined"), true, "the call threads the owned root exactly in contained mode")
  assert.equal(runner.includes('import { qualifyConditions, sha256 } from "./wave-manifest.mjs"'), false, "the import gains the constant")
  assert.equal(/import \{[^}]*OWNED_CONDITION_ATTACHMENTS[^}]*\} from "\.\/wave-manifest\.mjs"/.test(runner), true, "the constant is imported from the resolution home")
})
