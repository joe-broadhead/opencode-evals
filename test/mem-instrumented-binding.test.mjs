// File-only fixtures. No payload module is imported or executed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync, gunzipSync } from 'node:zlib'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, symlinkSync, linkSync, readdirSync, mkdirSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256, canonical } from '../src/util/canonical.mjs'
import { inspectInstrumentedArchive, buildInstrumentedBinding, validateInstrumentedBinding, stageInstrumentedBinding, validateStagedInstrumentedBinding } from '../src/run/mem-instrumented-binding.mjs'
import { bindingSchema } from '../src/run/mem-instrumented-schema.mjs'

function archive(files, entries = Object.entries(files)) {
  const blocks = []
  for (const [path, source, type = '0'] of entries) {
    const data = Buffer.from(source), h = Buffer.alloc(512)
    h.write(`package/${path}`, 0); h.write('0000600\0', 100)
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124)
    h.fill(32, 148, 156); h.write(type, 156); h.write('ustar\0', 257); h.write('00', 263)
    h.write([...h].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(h, data, Buffer.alloc((512 - data.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}
function payload(extra = {}) {
  return {
    'package.json': JSON.stringify({ name: '@joe-broadhead/opencode-mem', type: 'module', main: './index.js', exports: { '.': './index.js' }, files: ['index.js', 'src/'] }),
    'index.js': 'export { default } from "./src/index.js";\n',
    'src/index.js': 'export default {};\n',
    'src/runtime.js': 'export const runtime = 0;\n',
    ...extra,
  }
}
const pin = (files, bytes) => ({ archive_sha256: sha256(bytes), files: Object.fromEntries(Object.entries(files).map(([p, b]) => [p, sha256(b)])) })

test('archive inspection verifies an exact positive package file set without loading code', () => {
  const files = payload(), bytes = archive(files)
  const result = inspectInstrumentedArchive(bytes, pin(files, bytes))
  assert.equal(result.archive, 'verified')
  assert.equal(result.closure, 'complete')
  assert.equal(result.runtime, 'not-qualified')
  assert.equal(result.file_count, 4)
})

test('a literal external import is refused without a bound dependency profile', () => {
  const files = payload({ 'src/plugins/locate.js': 'export const load = () => import("@opencode/util/global");\n' })
  const bytes = archive(files)
  assert.throws(() => inspectInstrumentedArchive(bytes, pin(files, bytes)), error => {
    assert.equal(error.code, 'unapproved_external_dependency')
    assert.equal(error.archive, 'verified')
    assert.equal(error.closure, 'incomplete')
    assert.equal(error.runtime, 'not-qualified')
    return true
  })
})

function fixture({ dependency = false } = {}) {
  const patch = Buffer.from('diff --git a/src/index.js b/src/index.js\n--- a/src/index.js\n+++ b/src/index.js\n@@ -1,1 +1,2 @@\n-export default {};\n+export function createMemoryPlugin() { return {}; }\n+export default createMemoryPlugin();\ndiff --git a/src/runtime.js b/src/runtime.js\n--- a/src/runtime.js\n+++ b/src/runtime.js\n@@ -1,1 +1,1 @@\n-export const runtime = 0;\n+export const runtime = 1;\n')
  const spec = {
    purpose: 'finite-synthetic-fixture',
    factory: { path: 'src/index.js', export: 'createMemoryPlugin' },
    arms: {},
    patch: { sha256: sha256(patch), paths: ['src/index.js', 'src/runtime.js'] },
    composition: { files: {}, roles: {}, node_builtins: [], dependency_profiles: [], native_qualification: null },
  }
  const inputs = { arms: {}, patch, outside: new Map() }, filesByArm = {}
  for (const [i, arm] of ['baseline', 'candidate'].entries()) {
    const parent = payload({ 'src/identity.js': `export const arm = "${arm}";\n`, ...(dependency ? { 'src/plugins/locate.js': 'export const load = () => import("@opencode/util/global");\n' } : {}) })
    const derivative = { ...parent, 'src/index.js': 'export function createMemoryPlugin() { return {}; }\nexport default createMemoryPlugin();\n', 'src/runtime.js': 'export const runtime = 1;\n' }
    const parentArchive = archive(parent), derivativeArchive = archive(derivative)
    const commit = String(i + 1).repeat(40)
    spec.arms[arm] = {
      parent: { repository: 'synthetic-memory', commit, tree: String(i + 3).repeat(40), reference: { role: 'synthetic-fixture-reference', ...pin(parent, parentArchive) } },
      derivative: { commit: String(i + 5).repeat(40), parent: commit, tree: String(i + 7).repeat(40), ...pin(derivative, derivativeArchive) },
    }
    inputs.arms[arm] = { parentArchive, derivativeArchive }
    filesByArm[arm] = { parent, derivative }
    if (dependency) {
      const issuer = parent['src/plugins/locate.js'], site = 'import("@opencode/util/global")'
      const source = { repository: 'synthetic-dependency', commit: 'a'.repeat(40), tree: 'b'.repeat(40) }
      const runtime = { name: 'synthetic-runtime', version: 'fixture-1', sha256: 'c'.repeat(64) }
      const files = { 'dependency/global.js': 'export { value } from "./value.js";\n', 'dependency/value.js': 'export const value = "fixture";\n' }
      const profile = {
        kind: 'immutable-file-closure/1', arm, specifier: '@opencode/util/global',
        issuer: { path: 'src/plugins/locate.js', sha256: sha256(issuer) },
        site: { offset: issuer.indexOf(site), length: site.length, sha256: sha256(site) },
        entry: 'dependency/global.js', files: {}, resolver: {}, source, runtime,
      }
      for (const [p, text] of Object.entries(files)) {
        inputs.outside.set(p, Buffer.from(text)); spec.composition.files[p] = profile.files[p] = sha256(text)
      }
      const rule = { schema: 'oc-mem-exact-resolution/1', arm, specifier: profile.specifier, issuer: profile.issuer, site: profile.site, entry: profile.entry, files: profile.files, source, runtime }
      const resolverPath = `resolution-${arm}.json`, resolverBytes = Buffer.from(canonical(rule))
      inputs.outside.set(resolverPath, resolverBytes); spec.composition.files[resolverPath] = sha256(resolverBytes)
      profile.resolver = { path: resolverPath, sha256: sha256(resolverBytes) }
      spec.composition.dependency_profiles.push(profile)
    }
  }
  for (const role of ['composer', 'addon', 'bridge', 'gate', 'fixture', 'rules', 'schema', 'descriptions', 'operation_plan']) {
    const path = `${role}.json`, bytes = Buffer.from(JSON.stringify({ synthetic: role }))
    spec.composition.roles[role] = path; spec.composition.files[path] = sha256(bytes); inputs.outside.set(path, bytes)
  }
  return { spec, inputs, filesByArm }
}

test('complete synthetic paired inputs build, validate and stage bytes without qualifying runtime', () => {
  const { spec, inputs } = fixture(), built = buildInstrumentedBinding(spec, inputs)
  const result = validateInstrumentedBinding(built.binding, inputs, built.sha256)
  assert.deepEqual(result, { archive: 'verified', closure: 'complete', qualification: 'absent', runtime: 'not-qualified', binding_sha256: built.sha256 })
  const owner = mkdtempSync(join(tmpdir(), 'instrumented-binding-'))
  try {
    const staged = stageInstrumentedBinding(built.binding, inputs, { binding_sha256: built.sha256, owner_directory: owner })
    assert.equal(staged.directory, join(owner, built.sha256))
    assert.equal(readFileSync(join(staged.directory, 'baseline/src/runtime.js'), 'utf8'), 'export const runtime = 1;\n')
    assert.equal(readFileSync(join(staged.directory, 'candidate/src/identity.js'), 'utf8'), 'export const arm = "candidate";\n')
    assert.equal(staged.runtime, 'not-qualified')
    assert.throws(() => stageInstrumentedBinding(built.binding, inputs, { binding_sha256: built.sha256, owner_directory: owner }), /destination_exists/)
  } finally { rmSync(owner, { recursive: true, force: true }) }
})

test('finite dependency closure binds an exact issuer/site and inert resolution rules, then stages all bytes', () => {
  const { spec, inputs } = fixture({ dependency: true })
  const built = buildInstrumentedBinding(spec, inputs)
  const owner = mkdtempSync(join(tmpdir(), 'instrumented-profile-'))
  try {
    const staged = stageInstrumentedBinding(built.binding, inputs, { binding_sha256: built.sha256, owner_directory: owner })
    assert.equal(staged.closure, 'complete')
    assert.equal(staged.runtime, 'not-qualified')
    assert.equal(readFileSync(join(staged.directory, 'outside/dependency/value.js'), 'utf8'), 'export const value = "fixture";\n')
    assert.equal(JSON.parse(readFileSync(join(staged.directory, 'outside/resolution-baseline.json'))).specifier, '@opencode/util/global')
  } finally { rmSync(owner, { recursive: true, force: true }) }
})

test('package exclusions restrict the positive file list rather than granting extra files', () => {
  const files = payload(), pkg = JSON.parse(files['package.json'])
  pkg.files.push('!src/omitted.js'); files['package.json'] = JSON.stringify(pkg)
  const bytes = archive(files)
  assert.equal(inspectInstrumentedArchive(bytes, pin(files, bytes)).file_count, 4)
  const omitted = { ...files, 'src/omitted.js': 'export default 0;\n' }, bad = archive(omitted)
  assert.throws(() => inspectInstrumentedArchive(bad, pin(omitted, bad)), /outside_package_files/)
})

test('the candidate read-interface declaration remains bound without loading its entrypoints', () => {
  const files = payload({ 'service-interface/index.mjs': 'export const reads = 0;\n', 'service-interface/index.d.mts': 'export declare const reads: number;\n', 'service-interface/cli.mjs': 'export const cli = 0;\n' })
  const pkg = JSON.parse(files['package.json'])
  pkg.files.push('service-interface'); pkg.exports['./reads'] = { types: './service-interface/index.d.mts', import: './service-interface/index.mjs' }
  pkg.bin = { 'memory-read': './service-interface/cli.mjs' }; files['package.json'] = JSON.stringify(pkg)
  const bytes = archive(files)
  assert.equal(inspectInstrumentedArchive(bytes, pin(files, bytes)).file_count, 7)
})

test('archive verification refuses links, traversal, hidden/extra files, duplicates and malformed tar', () => {
  const files = payload(), bytes = archive(files), expected = pin(files, bytes)
  for (const [label, bad, message] of [
    ['changed bytes', Buffer.concat([bytes, Buffer.from('x')]), /archive_digest_mismatch/],
    ['duplicate', archive(files, [...Object.entries(files), ['src/index.js', files['src/index.js']]]), /duplicate_archive_entry/],
    ['symlink', archive(files, [...Object.entries(files), ['src/link.js', '', '2']]), /nonregular_tar_entry/],
    ['hardlink', archive(files, [...Object.entries(files), ['src/link.js', '', '1']]), /nonregular_tar_entry/],
    ['pax', archive(files, [...Object.entries(files), ['extended', '', 'x']]), /nonregular_tar_entry/],
    ['traversal', archive(files, [...Object.entries(files), ['src/../../escape.js', '']]), /unsafe_archive_path/],
    ['absolute', archive(files, [...Object.entries(files), ['/escape.js', '']]), /unsafe_archive_path/],
    ['hidden', archive(files, [...Object.entries(files), ['src/.hidden.js', '']]), /unsafe_archive_path/],
    ['extra', archive(files, [...Object.entries(files), ['src/extra.js', '']]), /file_closure_mismatch/],
    ['missing', archive(files, Object.entries(files).slice(1)), /file_closure_mismatch/],
    ['checksum', gzipSync(Buffer.from(gunzipSync(bytes)).fill(1, 0, 1)), /invalid_tar_checksum_or_size/],
    ['short end', gzipSync(gunzipSync(bytes).subarray(0, -512)), /invalid_tar_end/],
    ['trailing data', gzipSync(Buffer.concat([gunzipSync(bytes), Buffer.alloc(512, 1)])), /invalid_tar_end/],
  ]) {
    const p = label === 'changed bytes' ? expected : { ...expected, archive_sha256: sha256(bad) }
    assert.throws(() => inspectInstrumentedArchive(bad, p), message, label)
  }
})

test('binding metadata cannot substitute a parent, arm, role, schema, or approval flag', () => {
  for (const [name, change, message] of [
    ['parent', s => { s.arms.baseline.derivative.parent = 'f'.repeat(40) }, /source_identity_mismatch/],
    ['cross arm', s => { s.arms.candidate = structuredClone(s.arms.baseline) }, /cross_arm_identity/],
    ['official counterfeit', s => { s.arms.baseline.parent.reference.role = 'official-release' }, /counterfeit_fixture_role/],
    ['historical missing', s => { s.arms.baseline.parent.reference.archive_sha256 = null }, /missing_archive_identity/],
    ['factory', s => { s.factory.path = 'scratch/loader.js' }, /invalid_factory_entry/],
    ['approval', s => { s.composition.runtime_approved = true }, /invalid_fields/],
    ['missing role', s => { delete s.composition.roles.addon }, /invalid_fields/],
    ['missing file', s => { s.composition.roles.addon = 'missing.js' }, /missing_composition_role/],
    ['unknown purpose', s => { s.purpose = 'official-release' }, /invalid_comparison_purpose/],
    ['actual role counterfeit', s => { s.purpose = 'paired-instrumented-source' }, /invalid_reference_role/],
    ['patch identity', s => { s.patch.sha256 = '0'.repeat(64) }, /injection_patch_mismatch/],
    ['patch paths', s => { s.patch.paths.push('src/other.js') }, /injection_patch_mismatch/],
  ]) {
    const { spec, inputs } = fixture(); change(spec)
    assert.throws(() => buildInstrumentedBinding(spec, inputs), message, name)
  }
  const { spec, inputs } = fixture(), built = buildInstrumentedBinding(spec, inputs)
  for (const mutate of [b => { b.schema = 'oc-mem-arm/1' }, b => { b.schema_sha256 = '0'.repeat(64) }, b => { b.composition.files['rules.json'] = '0'.repeat(64) }]) {
    const altered = structuredClone(built.binding); mutate(altered)
    assert.throws(() => validateInstrumentedBinding(altered, inputs, built.sha256), /binding_identity_mismatch/)
  }
  assert.throws(() => validateInstrumentedBinding(built.binding, inputs), /binding_identity_mismatch/)
})

test('paired source identities come from fixed owner pins, not a hardcoded derivative tuple', () => {
  const f = fixture(); f.spec.purpose = 'paired-instrumented-source'
  for (const [arm, count, role] of [['baseline', 192, 'synthetic-source-reference-not-release'], ['candidate', 203, 'original-candidate-release-reference']]) {
    const { parent, derivative } = f.filesByArm[arm]
    for (let n = Object.keys(parent).length; n < count; n++) parent[`src/fixture-${n}.js`] = derivative[`src/fixture-${n}.js`] = `export const n = ${n};\n`
    const parentArchive = archive(parent), derivativeArchive = archive(derivative)
    f.inputs.arms[arm] = { parentArchive, derivativeArchive }
    Object.assign(f.spec.arms[arm].parent.reference, pin(parent, parentArchive), { role })
    Object.assign(f.spec.arms[arm].derivative, pin(derivative, derivativeArchive))
  }
  const built = buildInstrumentedBinding(f.spec, f.inputs)
  assert.equal(validateInstrumentedBinding(built.binding, f.inputs, built.sha256).runtime, 'not-qualified')
  assert.equal(built.binding.arms.baseline.derivative.commit, '5'.repeat(40))
  const changed = structuredClone(built.binding); changed.arms.baseline.derivative.commit = 'e'.repeat(40)
  assert.throws(() => validateInstrumentedBinding(changed, f.inputs, built.sha256), /binding_identity_mismatch/)
  f.spec.composition.dependency_profiles.push({})
  assert.throws(() => buildInstrumentedBinding(f.spec, f.inputs), /unapproved_external_dependency/)
})

test('the exact same reviewed patch must reproduce both derivative byte closures', () => {
  const { spec, inputs } = fixture()
  const changed = Buffer.from(inputs.patch.toString().replace('+export const runtime = 1;', '+export const runtime = 2;'))
  inputs.patch = changed; spec.patch.sha256 = sha256(changed)
  assert.throws(() => buildInstrumentedBinding(spec, inputs), /production_patch_mismatch/)
  const other = fixture()
  other.inputs.arms.candidate.derivativeArchive = other.inputs.arms.baseline.derivativeArchive
  assert.throws(() => buildInstrumentedBinding(other.spec, other.inputs), /archive_digest_mismatch/)
})

test('missing or changed outside bytes and incomplete dependency profiles fail before staging', () => {
  for (const [name, mutate, message] of [
    ['missing transitive bytes', (s, i) => i.outside.delete('dependency/value.js'), /file_closure_mismatch/],
    ['changed transitive bytes', (s, i) => i.outside.set('dependency/value.js', Buffer.from('export const value = 2;')), /file_closure_mismatch/],
    ['extra bytes', (s, i) => i.outside.set('extra.js', Buffer.from('export default 0;')), /file_closure_mismatch/],
    ['missing profile', s => { s.composition.dependency_profiles = [] }, /unapproved_external_dependency/],
    ['unapproved specifier', s => { s.composition.dependency_profiles[0].specifier = 'other/package' }, /unsupported_dependency_profile/],
    ['wrong issuer', s => { s.composition.dependency_profiles[0].issuer.sha256 = '0'.repeat(64) }, /dependency_issuer_mismatch/],
    ['wrong site', s => { s.composition.dependency_profiles[0].site.sha256 = '0'.repeat(64) }, /resolution_rules_mismatch/],
    ['missing source', s => { delete s.composition.dependency_profiles[0].source }, /invalid_fields/],
    ['missing runtime', s => { delete s.composition.dependency_profiles[0].runtime }, /invalid_fields/],
    ['missing resolver', s => { delete s.composition.dependency_profiles[0].resolver }, /invalid_fields/],
    ['duplicate profile', s => { s.composition.dependency_profiles.push(s.composition.dependency_profiles[0]) }, /duplicate_dependency_profile/],
    ['qualification flag', s => { s.composition.native_qualification = true }, /invalid_fields/],
  ]) {
    const { spec, inputs } = fixture({ dependency: true }); mutate(spec, inputs)
    assert.throws(() => buildInstrumentedBinding(spec, inputs), message, name)
  }
})

test('a transitive dependency cannot escape its bound closure even into a manifested add-on', () => {
  const { spec, inputs } = fixture({ dependency: true })
  const bytes = Buffer.from('export { value } from "../addon.js";\n')
  inputs.outside.set('dependency/value.js', bytes); spec.composition.files['dependency/value.js'] = sha256(bytes)
  inputs.outside.set('addon.js', Buffer.from('export const value = 2;\n')); spec.composition.files['addon.js'] = sha256(inputs.outside.get('addon.js'))
  for (const p of spec.composition.dependency_profiles) {
    p.files['dependency/value.js'] = sha256(bytes)
    const rule = JSON.parse(inputs.outside.get(p.resolver.path)); rule.files = p.files
    inputs.outside.set(p.resolver.path, Buffer.from(canonical(rule)))
    p.resolver.sha256 = spec.composition.files[p.resolver.path] = sha256(inputs.outside.get(p.resolver.path))
  }
  assert.throws(() => buildInstrumentedBinding(spec, inputs), /relative_import_escape_or_missing/)
})

test('closure refuses nonliteral, escaped, unmanifested, non-builtin and unsupported-syntax imports', () => {
  for (const [source, message] of [
    ['export const load = () => import(name);', /nonliteral_or_extended_dynamic_import/],
    ['import "other-package";', /unapproved_external_dependency/],
    ['import "node:fs";', /unapproved_external_dependency/],
    ['import "../escape.js";', /relative_import_escape_or_missing/],
    ['import "./missing.js";', /relative_import_escape_or_missing/],
    ['import "./\\u006dissing.js";', /escaped_import_specifier/],
    ['export const x = `template ${import("evil")}`;', /unsupported_module_syntax/],
  ]) {
    const files = payload({ 'src/index.js': source }), bytes = archive(files)
    assert.throws(() => inspectInstrumentedArchive(bytes, pin(files, bytes)), message)
  }
})

test('an explicit Node builtin allowance and a qualification citation never grant runtime qualification', () => {
  const { spec, inputs } = fixture()
  const code = Buffer.from('import { sep } from "node:path"; export { sep };\n')
  inputs.outside.set('addon.js', code); spec.composition.files['addon.js'] = sha256(code); spec.composition.roles.addon = 'addon.js'
  assert.throws(() => buildInstrumentedBinding(spec, inputs), /unapproved_external_dependency/)
  spec.composition.node_builtins = ['node:path']
  spec.composition.native_qualification = { evidence: 'fixture.json', source: { repository: 'synthetic-qualification', commit: 'a'.repeat(40), tree: 'b'.repeat(40) }, runtime: { name: 'synthetic-runtime', version: '1', sha256: 'c'.repeat(64) } }
  const built = buildInstrumentedBinding(spec, inputs), result = validateInstrumentedBinding(built.binding, inputs, built.sha256)
  assert.equal(result.qualification, 'claim-recorded-unverified')
  assert.equal(result.runtime, 'not-qualified')
  spec.composition.node_builtins.push('node:invented')
  assert.throws(() => buildInstrumentedBinding(spec, inputs), /invalid_builtin_allowance/)
})

test('staged validation detects changed bytes, unmanifested files, symbolic links and hard links', () => {
  for (const kind of ['changed', 'extra', 'symlink', 'hardlink']) {
    const { spec, inputs } = fixture({ dependency: true }), built = buildInstrumentedBinding(spec, inputs)
    const owner = mkdtempSync(join(tmpdir(), 'instrumented-stage-'))
    const target = { binding_sha256: built.sha256, owner_directory: owner }
    try {
      const staged = stageInstrumentedBinding(built.binding, inputs, target)
      assert.equal(validateStagedInstrumentedBinding(built.binding, inputs, target).closure, 'complete')
      const file = join(staged.directory, 'outside/dependency/value.js')
      if (kind === 'changed') { chmodSync(file, 0o600); writeFileSync(file, 'export const value = "changed";\n') }
      if (kind === 'extra') writeFileSync(join(staged.directory, 'outside/extra.js'), 'export default 0;\n')
      if (kind === 'symlink') { rmSync(file); symlinkSync(join(staged.directory, 'baseline/src/runtime.js'), file) }
      if (kind === 'hardlink') linkSync(file, join(owner, 'linked.js'))
      assert.throws(() => validateStagedInstrumentedBinding(built.binding, inputs, target), /staged_/)
    } finally { rmSync(owner, { recursive: true, force: true }) }
  }
})

test('staging refuses incomplete inputs before writing and rejects symlinked owner destinations', () => {
  const { spec, inputs } = fixture(), built = buildInstrumentedBinding(spec, inputs)
  const owner = mkdtempSync(join(tmpdir(), 'instrumented-owner-'))
  try {
    const bad = { ...inputs, outside: new Map(inputs.outside) }; bad.outside.delete('gate.json')
    assert.throws(() => stageInstrumentedBinding(built.binding, bad, { binding_sha256: built.sha256, owner_directory: owner }), /file_closure_mismatch/)
    assert.deepEqual(readdirSync(owner), [])
    symlinkSync(owner, join(owner, 'alias'))
    assert.throws(() => stageInstrumentedBinding(built.binding, inputs, { binding_sha256: built.sha256, owner_directory: join(owner, 'alias') }), /unsafe_owner_directory/)
  } finally { rmSync(owner, { recursive: true, force: true }) }
})

test('closed metadata refuses unknown fields before canonicalization can discard them', () => {
  const f = fixture(); f.spec.factory.approved = undefined
  assert.throws(() => buildInstrumentedBinding(f.spec, f.inputs), /invalid_fields/)
  const g = fixture({ dependency: true }), profile = g.spec.composition.dependency_profiles[0]
  const rule = JSON.parse(g.inputs.outside.get(profile.resolver.path))
  Object.defineProperty(rule.issuer, '__proto__', { value: { approved: true }, enumerable: true })
  const raw = Buffer.from(JSON.stringify(rule))
  g.inputs.outside.set(profile.resolver.path, raw)
  profile.resolver.sha256 = g.spec.composition.files[profile.resolver.path] = sha256(raw)
  assert.throws(() => buildInstrumentedBinding(g.spec, g.inputs), /invalid_resolution_rules/)
})

test('inspection reads executable-looking bytes as data and never imports the payload', () => {
  const files = payload({ 'src/index.js': 'throw new Error("PAYLOAD_MUST_NOT_EXECUTE"); export default {};\n' })
  const bytes = archive(files)
  assert.equal(inspectInstrumentedArchive(bytes, pin(files, bytes)).runtime, 'not-qualified')
})

test('a caller cannot mutate the shared schema to remove a required composition role', () => {
  assert.throws(() => bindingSchema.roles.splice(bindingSchema.roles.indexOf('gate'), 1), TypeError)
  const f = fixture(); delete f.spec.composition.roles.gate
  assert.throws(() => buildInstrumentedBinding(f.spec, f.inputs), /invalid_fields/)
})

test('the fixed factory claim requires a literal exported factory declaration, not only a schema field', () => {
  const f = fixture()
  f.inputs.patch = Buffer.from(f.inputs.patch.toString().replaceAll('createMemoryPlugin', 'otherFactory'))
  f.spec.patch.sha256 = sha256(f.inputs.patch)
  for (const arm of ['baseline', 'candidate']) {
    const files = f.filesByArm[arm].derivative
    files['src/index.js'] = files['src/index.js'].replaceAll('createMemoryPlugin', 'otherFactory')
    const bytes = archive(files)
    f.inputs.arms[arm].derivativeArchive = bytes; Object.assign(f.spec.arms[arm].derivative, pin(files, bytes))
  }
  assert.throws(() => buildInstrumentedBinding(f.spec, f.inputs), /missing_factory_export/)
})

test('composition paths are strings, not coerced property names', () => {
  const f = fixture(), bytes = Buffer.from('{}')
  f.inputs.outside.set('1', bytes); f.spec.composition.files['1'] = sha256(bytes)
  f.spec.composition.roles.addon = 1
  assert.throws(() => buildInstrumentedBinding(f.spec, f.inputs), /missing_composition_role/)
})

for (const [label, terminator] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r'], ['LS', '\u2028'], ['PS', '\u2029']]) {
  test(`${label} line-comment termination cannot hide an external import at any public interface`, () => {
    const code = `// harmless comment${terminator}import "unapproved-package";\n`
    const files = payload({ 'src/after-comment.js': code }), bytes = archive(files)
    assert.throws(() => inspectInstrumentedArchive(bytes, pin(files, bytes)), { code: 'unapproved_external_dependency', archive: 'verified', closure: 'incomplete', runtime: 'not-qualified' })

    const f = fixture(), clean = buildInstrumentedBinding(f.spec, f.inputs)
    const owner = mkdtempSync(join(tmpdir(), 'instrumented-line-comment-'))
    try {
      const staged = stageInstrumentedBinding(clean.binding, f.inputs, { binding_sha256: clean.sha256, owner_directory: owner })
      assert.equal(staged.runtime, 'not-qualified')
      f.inputs.outside.set('addon.js', Buffer.from(code))
      f.spec.composition.files['addon.js'] = sha256(code); f.spec.composition.roles.addon = 'addon.js'
      // Model a self-consistent owner binding and staged bytes, not a stale digest.
      // These source strings remain data: no import, evaluation or module load.
      const binding = { ...clean.binding, composition: structuredClone(f.spec.composition) }
      const expected = sha256(canonical(binding)), directory = join(owner, expected)
      renameSync(staged.directory, directory)
      chmodSync(join(directory, 'binding.json'), 0o600)
      writeFileSync(join(directory, 'binding.json'), canonical(binding) + '\n')
      chmodSync(join(directory, 'binding.json'), 0o400)
      writeFileSync(join(directory, 'outside/addon.js'), code, { flag: 'wx', mode: 0o400 })
      assert.throws(() => buildInstrumentedBinding(f.spec, f.inputs), { code: 'unapproved_external_dependency' })
      assert.throws(() => validateInstrumentedBinding(binding, f.inputs, expected), { code: 'unapproved_external_dependency' })
      assert.throws(() => validateStagedInstrumentedBinding(binding, f.inputs, { binding_sha256: expected, owner_directory: owner }), { code: 'unapproved_external_dependency' })
      const emptyOwner = join(owner, 'empty'); mkdirSync(emptyOwner, { mode: 0o700 })
      assert.throws(() => stageInstrumentedBinding(binding, f.inputs, { binding_sha256: expected, owner_directory: emptyOwner }), { code: 'unapproved_external_dependency' })
      assert.deepEqual(readdirSync(emptyOwner), [])
    } finally { rmSync(owner, { recursive: true, force: true }) }
  })
}
