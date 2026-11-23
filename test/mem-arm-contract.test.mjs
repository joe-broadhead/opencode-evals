// Offline only: the real Memory corpus packaging contract against synthetic fixtures
// that reproduce the cleared arms' exact member classes and import forms.
//
// Tracked limits (documented here, deliberately NOT asserted): the classifier currently
// admits two live-executed residual shapes — a comparison operator before a real dynamic
// import on a '*'-headed continuation line (`const x = a\n  * b<import("./missing.js")`),
// whose '<import(' prefix is indistinguishable from a JSDoc type reference to the
// two-character exception test, and a multi-line export-star whose specifier lands on
// a prose-skipped line (`export\n* from "./missing.js"`). Neither shape occurs in the
// censused staged arms; both pre-exist the parent classifier. The committed fix is a
// bounded comment-aware scanner; regressions for both shapes belong here after that
// scanner lands, not before. No assertion below covers these shapes, so this suite
// makes no coverage claim about them.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { sha256 } from "../src/util/canonical.mjs"
import { memoryArtifact, materialiseMemoryArm } from "../src/run/mem-arm.mjs"

/** The cleared real-corpus shape: top-level docs beyond README, shared page helpers,
 * HTML views, the records backend, multi-line import clauses, side-effect imports,
 * and the exact data-string/comment sites that are not import statements. */
function corpusFixture(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "mem-arm-contract-")), source = join(root, "artifact")
  for (const dir of ["src", "src/views", "skills/mem.usage", "docs", "shared", "views", "records/src", "service-interface"]) mkdirSync(join(source, dir), { recursive: true })
  const entries = {
    "package.json": JSON.stringify({ name: "@joe-broadhead/opencode-mem", version: "0.15.14", main: "./index.js" }),
    "index.js": 'export { default } from "./src/index.js"',
    "README.md": "# Memory",
    "CHANGELOG.md": "## [0.15.14] - 2026-11-01\n- Corpus packaging includes this member class.\n",
    "SECURITY.md": "# Security policy\n",
    "LICENSE": "Synthetic license.",
    "shared/page-paths.js": 'import { createHash } from "node:crypto"\nexport const pagePathFor = (kind) => `/${kind}`\n',
    "shared/page-sections.js": 'import { createHash } from "node:crypto"\nexport const sectionAnchor = (title) => String(createHash("sha256").update(title).digest("hex")).slice(0, 8)\n',
    "views/home.html": "<!doctype html>\n<main>home</main>\n",
    "views/today.html": "<!doctype html>\n<main>today</main>\n",
    "records/src/record-enums.js": 'export const RECORD_KINDS = ["note", "page"]\n',
    "service-interface/registry.mjs": 'import { RECORD_KINDS } from "../records/src/record-enums.js"\nexport const registry = { kinds: RECORD_KINDS }\n',
    "src/index.js": [
      'import { sectionAnchor } from "../shared/page-sections.js"',
      'import {\n  registerMirroredSkills,\n  syncSkills,\n} from "./skills.js"',
      'import "./side-effect.js"',
      'export default { id: "mem" }',
    ].join("\n"),
    "src/skills.js": 'export const registerMirroredSkills = () => true\nexport const syncSkills = () => true\n',
    "src/side-effect.js": 'export const started = true\n',
    "src/views/contracts.js": [
      "const REQUIRED = [",
      '  ["id", "state", "target", "from", "to", "at"],',
      '  required: ["op", "label", "from"],',
      "];",
      'export const contracts = REQUIRED',
    ].join("\n"),
    "src/actions.js": [
      "const QUERY_STOPWORDS = new Set([",
      '  "the", "and", "for", "with", "that", "this", "these", "those", "from", "what", "which",',
      "]);",
      "const SCHEMA = defineSchema({",
      "  properties: {",
      "    space: text(128),",
      "  },",
      '  ["text", "from"],',
      "  tool: \"mem.remember\",",
      "});",
    ].join("\n"),
    "src/spaces.js": [
      "/**",
      ' * Control failure. `status` is 0 for transport failures and 408',
      ' * for a timeout, so callers can tell "denied" from "unreachable".',
      " */",
      'import { pagePathFor } from "../shared/page-paths.js"\nexport const spacePaths = pagePathFor',
    ].join("\n"),
    "src/typed.js": [
      "/**",
      ' * @param {ReturnType<import("./skills.js").syncSkills>} tick',
      " */",
      'export const typed = 1',
    ].join("\n"),
    "src/words.js": [
      'const STOP = new Set(["import", "export", "write", "put", "save", "publish"])',
      "export const stop = (word) => STOP.has(word)",
    ].join("\n"),
    "src/prose.js": [
      "/**",
      ' * the gate found agents storing a day they worked out from "next week"',
      " */",
      'export const prose = "held"',
    ].join("\n"),
    "skills/mem.usage/SKILL.md": "Synthetic bundled skill.",
    "docs/agent-instructions.md": "Synthetic instructions.",
  }
  for (const [file, text] of Object.entries(entries)) writeFileSync(join(source, file), text)
  const files = Object.fromEntries(Object.entries(entries).map(([p, t]) => [p, sha256(t)]))
  const manifest = { schema: "oc-mem-arm/1", source_commit: "6".repeat(40), archive_sha256: "b".repeat(64), files }
  writeFileSync(join(source, ".mem-arm.json"), JSON.stringify(manifest))
  return { root, source, entries, manifest, out: join(root, "out"), ...extra }
}

const rewrite = (f, p, text) => {
  const entries = { ...f.entries, [p]: text }
  writeFileSync(join(f.source, p), text)
  const files = { ...f.manifest.files, [p]: sha256(text) }
  f.manifest = { ...f.manifest, files }
  writeFileSync(join(f.source, ".mem-arm.json"), JSON.stringify(f.manifest))
  return { ...f, entries }
}

test("the real corpus member classes and import forms pass the arm contract", () => {
  const f = corpusFixture()
  try {
    const manifest = memoryArtifact(f.source)
    assert.equal(manifest.schema, "oc-mem-arm/1")
    // Every previously-dropped class is admitted and hashed into the artifact.
    for (const p of ["CHANGELOG.md", "SECURITY.md", "shared/page-paths.js", "shared/page-sections.js", "views/home.html", "views/today.html", "records/src/record-enums.js", "service-interface/registry.mjs"]) {
      assert.equal(manifest.files[p], sha256(f.entries[p]), p)
    }
    assert.equal(typeof manifest.closure_sha256, "string")
    const out = materialiseMemoryArm(f.source, f.out)
    assert.equal(readFileSync(join(out, "views/home.html"), "utf8"), f.entries["views/home.html"])
    assert.equal(readFileSync(join(out, "records/src/record-enums.js"), "utf8"), f.entries["records/src/record-enums.js"])
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("a genuinely external import still refuses the arm", () => {
  const f = rewrite(corpusFixture(), "src/skills.js", 'import { ext } from "external-package"\nexport const ext2 = ext\n')
  try { assert.throws(() => memoryArtifact(f.source), /Memory closure has an external runtime import: src\/skills\.js/) }
  finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("an unknown member class outside the documented real set still refuses", () => {
  const f = corpusFixture()
  try {
    mkdirSync(join(f.source, "translations"))
    writeFileSync(join(f.source, "translations/fr.md"), "un classeur inconnu")
    const files = { ...f.manifest.files, "translations/fr.md": sha256("un classeur inconnu") }
    writeFileSync(join(f.source, ".mem-arm.json"), JSON.stringify({ ...f.manifest, files }))
    assert.throws(() => memoryArtifact(f.source), /unsafe Memory manifest path or digest: translations\/fr\.md/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("a broken closure edge — a needed member removed — still refuses", () => {
  const f = corpusFixture()
  try {
    rmSync(join(f.source, "shared/page-sections.js"))
    const files = { ...f.manifest.files }
    delete files["shared/page-sections.js"]
    writeFileSync(join(f.source, ".mem-arm.json"), JSON.stringify({ ...f.manifest, files }))
    assert.throws(() => memoryArtifact(f.source), /Memory import closure is missing shared\/page-sections\.js/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("an unclassifiable import form refuses rather than being silently accepted", () => {
  // Mid-line or oddly positioned specifiers are neither verifiable statements nor
  // provably string data: the contract fails closed instead of guessing.
  for (const code of [
    'const label = items from "tail.js"\nexport const l = label\n',
    'export const picked = chose from "tail.js"\n',
    'const mod = await import(name)\nexport const m = mod\n',
  ]) {
    const f = rewrite(corpusFixture(), "src/skills.js", code)
    try {
      if (code.includes("import(name)")) assert.throws(() => memoryArtifact(f.source), /nonliteral import/)
      else assert.throws(() => memoryArtifact(f.source), /import form is unclassifiable/, code)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }
})

test("comment-close and expression-continuation import shapes on '*'-headed lines refuse", () => {
  // A line head beginning '*/' closes a block comment: the rest of the line is
  // executable code. A '*' can also head a valid multiplication continuation line.
  // Both are live import positions the prose skip must never silently admit.
  for (const code of [
    '/* prose\n*/ import { x } from "external-pkg"\nexport const y = x\n',
    '/* prose\n*/ import "./evil.js"\nexport const y = 1\n',
    '/* prose\n*/ import("./evil.js")\nexport const y = 1\n',
    'const x = a\n  * import("./missing.js")\nexport const y = x\n',
    'const x = a\n  * import("external-pkg")\nexport const y = x\n',
  ]) {
    const f = rewrite(corpusFixture(), "src/skills.js", code)
    try { assert.throws(() => memoryArtifact(f.source), /import form is unclassifiable/, code) }
    finally { rmSync(f.root, { recursive: true, force: true }) }
  }
})

test("JSDoc '<import(' type references on '*'-headed comment lines keep skipping", () => {
  const f = rewrite(corpusFixture(), "src/skills.js", [
    "/**",
    ' * @param {ReturnType<import("./side-effect.js").started>} tick',
    " */",
    "export const ns = 1",
  ].join("\n"))
  try {
    const manifest = memoryArtifact(f.source)
    assert.equal(manifest.files["src/skills.js"], sha256(f.entries["src/skills.js"]))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("an import-shaped line that is not exact statement grammar refuses", () => {
  const f = rewrite(corpusFixture(), "src/skills.js", 'import { a } extra from "tail.js"\nexport const x = 1\n')
  try { assert.throws(() => memoryArtifact(f.source), /import form is unclassifiable/) }
  finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("the package entrypoint and dependency contract is unchanged", () => {
  const f = rewrite(corpusFixture(), "package.json", JSON.stringify({ name: "@joe-broadhead/opencode-mem", version: "0.15.14", main: "./index.js", dependencies: { anything: "*" } }))
  try { assert.throws(() => memoryArtifact(f.source), /entrypoint\/dependency contract differs/) }
  finally { rmSync(f.root, { recursive: true, force: true }) }
})
