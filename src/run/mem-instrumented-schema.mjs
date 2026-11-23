import { canonical, sha256 } from '../util/canonical.mjs'
import { digest, exactKeys, filePins, refuse, safePath } from './mem-instrumented-archive.mjs'

// Closed wire schema. Changing fields or their interpretation requires a version.
export const bindingSchema = Object.freeze({
  id: 'oc-mem-instrumented-comparison/1',
  binding: ['schema', 'schema_sha256', 'purpose', 'factory', 'arms', 'patch', 'composition'],
  parent: ['repository', 'commit', 'tree', 'reference'],
  reference: ['role', 'archive_sha256', 'files'],
  derivative: ['commit', 'parent', 'tree', 'archive_sha256', 'files'],
  composition: ['files', 'roles', 'node_builtins', 'dependency_profiles', 'native_qualification'],
  roles: ['composer', 'addon', 'bridge', 'gate', 'fixture', 'rules', 'schema', 'descriptions', 'operation_plan'],
  profile: ['kind', 'arm', 'specifier', 'issuer', 'site', 'entry', 'files', 'resolver', 'source', 'runtime'],
})
for (const value of Object.values(bindingSchema)) if (Array.isArray(value)) Object.freeze(value)
export const bindingSchemaHash = sha256(canonical(bindingSchema))
const oid = v => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v)

function sourcePin(source) {
  exactKeys(source, ['repository', 'commit', 'tree'])
  if (typeof source.repository !== 'string' || !source.repository.trim() || source.repository.length > 512 || !oid(source.commit) || !oid(source.tree)) refuse('invalid_dependency_source')
}
function runtimePin(runtime) {
  exactKeys(runtime, ['name', 'version', 'sha256'])
  if (![runtime.name, runtime.version].every(v => typeof v === 'string' && v.length > 0 && v.length < 200) || !digest(runtime.sha256)) refuse('invalid_runtime_pin')
}

function profileShape(profile, composition) {
  exactKeys(profile, bindingSchema.profile)
  if (profile.kind !== 'immutable-file-closure/1' || !['baseline', 'candidate'].includes(profile.arm) || profile.specifier !== '@opencode/util/global') refuse('unsupported_dependency_profile')
  exactKeys(profile.issuer, ['path', 'sha256']); exactKeys(profile.site, ['offset', 'length', 'sha256'])
  if (profile.issuer.path !== 'src/plugins/locate.js' || !digest(profile.issuer.sha256) || !digest(profile.site.sha256) || !Number.isSafeInteger(profile.site.offset) || profile.site.offset < 0 || !Number.isSafeInteger(profile.site.length) || profile.site.length <= 0) refuse('invalid_dependency_site')
  filePins(profile.files)
  if (!Object.hasOwn(profile.files, profile.entry) || !/\.m?js$/.test(profile.entry)) refuse('missing_dependency_entry')
  for (const [p, hash] of Object.entries(profile.files)) if (composition.files[p] !== hash) refuse('unbound_dependency_file', p)
  exactKeys(profile.resolver, ['path', 'sha256'])
  if (!digest(profile.resolver.sha256) || composition.files[profile.resolver.path] !== profile.resolver.sha256 || !profile.resolver.path.endsWith('.json')) refuse('unbound_resolver_identity')
  sourcePin(profile.source); runtimePin(profile.runtime)
}

export function validateBindingShape(m) {
  exactKeys(m, bindingSchema.binding)
  if (m.schema !== bindingSchema.id || m.schema_sha256 !== bindingSchemaHash) refuse('binding_schema_mismatch')
  if (!['paired-instrumented-source', 'finite-synthetic-fixture'].includes(m.purpose)) refuse('invalid_comparison_purpose')
  exactKeys(m.factory, ['path', 'export'])
  if (m.factory.path !== 'src/index.js' || m.factory.export !== 'createMemoryPlugin') refuse('invalid_factory_entry')
  exactKeys(m.arms, ['baseline', 'candidate'])
  for (const arm of ['baseline', 'candidate']) {
    const a = m.arms[arm]
    exactKeys(a, ['parent', 'derivative']); exactKeys(a.parent, bindingSchema.parent)
    exactKeys(a.parent.reference, bindingSchema.reference); exactKeys(a.derivative, bindingSchema.derivative)
    if (typeof a.parent.repository !== 'string' || !a.parent.repository.trim() || a.parent.repository.length > 512) refuse('missing_source_repository')
    if (![a.parent.commit, a.parent.tree, a.derivative.commit, a.derivative.parent, a.derivative.tree].every(oid) || a.derivative.parent !== a.parent.commit || a.derivative.commit === a.parent.commit) refuse('source_identity_mismatch')
    for (const p of [a.parent.reference, a.derivative]) { if (!digest(p.archive_sha256)) refuse('missing_archive_identity'); filePins(p.files) }
    if (m.purpose === 'paired-instrumented-source') {
      const count = arm === 'baseline' ? 192 : 203
      const role = arm === 'baseline' ? 'synthetic-source-reference-not-release' : 'original-candidate-release-reference'
      if (a.parent.reference.role !== role) refuse('invalid_reference_role', arm)
      if (Object.keys(a.parent.reference.files).length !== count || Object.keys(a.derivative.files).length !== count) refuse('paired_file_count_mismatch', arm)
    } else {
      if (a.parent.reference.role !== 'synthetic-fixture-reference') refuse('counterfeit_fixture_role')
    }
  }
  if (m.arms.baseline.derivative.archive_sha256 === m.arms.candidate.derivative.archive_sha256 || m.arms.baseline.derivative.commit === m.arms.candidate.derivative.commit || m.arms.baseline.parent.commit === m.arms.candidate.parent.commit) refuse('cross_arm_identity')
  exactKeys(m.patch, ['sha256', 'paths'])
  if (!digest(m.patch.sha256) || canonical(m.patch.paths) !== canonical(['src/index.js', 'src/runtime.js'])) refuse('injection_patch_mismatch')
  exactKeys(m.composition, bindingSchema.composition); filePins(m.composition.files)
  exactKeys(m.composition.roles, bindingSchema.roles)
  for (const p of Object.values(m.composition.roles)) if (!safePath(p) || !Object.hasOwn(m.composition.files, p)) refuse('missing_composition_role')
  if (!Array.isArray(m.composition.node_builtins) || !Array.isArray(m.composition.dependency_profiles)) refuse('invalid_closure_policy')
  // The finite profile fixture exercises closure binding, not a real-arm exception.
  if (m.purpose === 'paired-instrumented-source' && m.composition.dependency_profiles.length) refuse('unapproved_external_dependency')
  if (m.composition.dependency_profiles.length > 2) refuse('duplicate_dependency_profile')
  const arms = new Set()
  for (const profile of m.composition.dependency_profiles) {
    profileShape(profile, m.composition)
    if (arms.has(profile.arm)) refuse('duplicate_dependency_profile')
    arms.add(profile.arm)
    if (m.arms[profile.arm].derivative.files[profile.issuer.path] !== profile.issuer.sha256) refuse('dependency_issuer_mismatch')
  }
  if (m.composition.native_qualification !== null) {
    const q = m.composition.native_qualification
    exactKeys(q, ['evidence', 'source', 'runtime'])
    if (!safePath(q.evidence) || !Object.hasOwn(m.composition.files, q.evidence)) refuse('unbound_qualification_evidence')
    sourcePin(q.source); runtimePin(q.runtime)
  }
}
