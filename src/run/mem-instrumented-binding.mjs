import { lstatSync, realpathSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, dirname, join, parse } from 'node:path'
import { canonical, sha256 } from '../util/canonical.mjs'
import { readInstrumentedArchive, exactKeys, verifyFiles, refuse, digest } from './mem-instrumented-archive.mjs'
import { checkClosure } from './mem-instrumented-closure.mjs'
import { bindingSchema, bindingSchemaHash, validateBindingShape } from './mem-instrumented-schema.mjs'
import { verifyInjection } from './mem-instrumented-patch.mjs'

function resolutionData(value) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) refuse('invalid_resolution_rules')
    resolutionData(child)
  }
}

/** Integrity inspection only. No module loader or runtime permission is returned. */
export function inspectInstrumentedArchive(archive, pin) {
  const bytes = readInstrumentedArchive(archive, pin)
  try { checkClosure(bytes) } catch (error) {
    throw Object.assign(error, { archive: 'verified', closure: 'incomplete', runtime: 'not-qualified' })
  }
  return { archive: 'verified', closure: 'complete', runtime: 'not-qualified', file_count: bytes.size }
}

function prepare(binding, inputs) {
  validateBindingShape(binding)
  exactKeys(inputs, ['arms', 'patch', 'outside']); exactKeys(inputs.arms, ['baseline', 'candidate'])
  if (!Buffer.isBuffer(inputs.patch) || sha256(inputs.patch) !== binding.patch.sha256) refuse('injection_patch_mismatch')
  if (!(inputs.outside instanceof Map)) refuse('invalid_outside_inputs')
  const outside = new Map([...inputs.outside].map(([p, b]) => {
    if (!Buffer.isBuffer(b)) refuse('nonbyte_input', p)
    return [p, Buffer.from(b)]
  }))
  verifyFiles(outside, binding.composition.files)
  for (const profile of binding.composition.dependency_profiles) {
    const rule = { schema: 'oc-mem-exact-resolution/1', arm: profile.arm, specifier: profile.specifier, issuer: profile.issuer, site: profile.site, entry: profile.entry, files: profile.files, source: profile.source, runtime: profile.runtime }
    let actual
    try { actual = JSON.parse(outside.get(profile.resolver.path).toString('utf8')) } catch { refuse('invalid_resolution_rules') }
    resolutionData(actual)
    if (canonical(actual) !== canonical(rule)) refuse('resolution_rules_mismatch')
    const dependency = new Map(Object.keys(profile.files).map(p => [p, outside.get(p)]))
    verifyFiles(dependency, profile.files)
    checkClosure(dependency, { node_builtins: binding.composition.node_builtins })
  }
  const staged = new Map([['injection.patch', Buffer.from(inputs.patch)], ['binding.json', Buffer.from(canonical(binding) + '\n')]])
  for (const arm of ['baseline', 'candidate']) {
    const a = binding.arms[arm], source = inputs.arms[arm]
    exactKeys(source, ['parentArchive', 'derivativeArchive'])
    const archivePin = p => ({ archive_sha256: p.archive_sha256, files: p.files })
    const parent = readInstrumentedArchive(source.parentArchive, archivePin(a.parent.reference))
    const derivative = readInstrumentedArchive(source.derivativeArchive, archivePin(a.derivative))
    verifyInjection(parent, derivative, inputs.patch)
    checkClosure(derivative, { ...binding.composition, arm, requireFactory: true })
    for (const [p, b] of derivative) staged.set(`${arm}/${p}`, b)
  }
  checkClosure(outside, { node_builtins: binding.composition.node_builtins })
  for (const [p, b] of outside) staged.set(`outside/${p}`, b)
  return staged
}
const result = (hash, binding) => ({ archive: 'verified', closure: 'complete', qualification: binding.composition.native_qualification === null ? 'absent' : 'claim-recorded-unverified', runtime: 'not-qualified', binding_sha256: hash })

/** Build only from parent-owned byte inputs. The output digest is not an approval. */
export function buildInstrumentedBinding(spec, inputs) {
  exactKeys(spec, ['purpose', 'factory', 'arms', 'patch', 'composition'])
  const draft = { schema: bindingSchema.id, schema_sha256: bindingSchemaHash, ...spec }
  validateBindingShape(draft)
  const binding = JSON.parse(canonical(draft))
  prepare(binding, inputs)
  return { binding, sha256: sha256(canonical(binding)) }
}

function checkExpected(binding, expected) {
  if (!digest(expected) || sha256(canonical(binding)) !== expected) refuse('binding_identity_mismatch')
}

/** expected must come from the parent owner, never from model output or this manifest. */
export function validateInstrumentedBinding(binding, inputs, expected) {
  checkExpected(binding, expected); prepare(binding, inputs)
  return result(expected, binding)
}

function ownedDestination(target) {
  const owner = target.owner_directory
  if (typeof owner !== 'string' || resolve(owner) !== owner || realpathSync(owner) !== owner) refuse('unsafe_owner_directory')
  for (let p = owner; p !== parse(p).root; p = dirname(p)) if (lstatSync(p).isSymbolicLink()) refuse('unsafe_owner_directory')
  const stat = lstatSync(owner)
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) refuse('unsafe_owner_directory')
  return join(owner, target.binding_sha256)
}

/** File-only staging. No import URL, loader, authority token or acceptance is returned. */
export function stageInstrumentedBinding(binding, inputs, target) {
  exactKeys(target, ['binding_sha256', 'owner_directory'])
  checkExpected(binding, target.binding_sha256)
  const bytes = prepare(binding, inputs) // Complete all integrity/closure checks before mkdir.
  const directory = ownedDestination(target)
  if (existsSync(directory)) refuse('destination_exists')
  mkdirSync(directory, { mode: 0o700 }) // Exclusive creation; never replace a prior destination.
  try {
    for (const [p, b] of bytes) {
      mkdirSync(dirname(join(directory, p)), { recursive: true, mode: 0o700 })
      writeFileSync(join(directory, p), b, { flag: 'wx', mode: 0o400 })
    }
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error }
  return { ...result(target.binding_sha256, binding), directory }
}

/** Revalidate with the original fixed inputs, including every staged byte and path. */
export function validateStagedInstrumentedBinding(binding, inputs, target) {
  exactKeys(target, ['binding_sha256', 'owner_directory'])
  checkExpected(binding, target.binding_sha256)
  const expected = prepare(binding, inputs), directory = ownedDestination(target)
  const allowedDirs = new Set([''])
  for (const p of expected.keys()) for (let dir = dirname(p); dir !== '.'; dir = dirname(dir)) allowedDirs.add(dir)
  const seen = new Set()
  const walk = relative => {
    const path = join(directory, relative), stat = lstatSync(path)
    if (stat.isSymbolicLink()) refuse('staged_link', relative)
    if (stat.isDirectory()) {
      if (!allowedDirs.has(relative)) refuse('staged_extra_directory', relative)
      for (const name of readdirSync(path)) walk(relative ? `${relative}/${name}` : name)
      return
    }
    const bytes = expected.get(relative)
    if (!stat.isFile() || stat.nlink !== 1 || !bytes || stat.size !== bytes.length || !readFileSync(path).equals(bytes)) refuse('staged_file_mismatch', relative)
    seen.add(relative)
  }
  walk('')
  if (seen.size !== expected.size) refuse('staged_missing_file')
  return { ...result(target.binding_sha256, binding), directory }
}
