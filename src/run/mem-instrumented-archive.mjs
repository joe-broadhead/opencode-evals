// Read a bounded npm archive without extracting, importing, or executing members.
import { gunzipSync } from 'node:zlib'
import { sha256, canonical } from '../util/canonical.mjs'

export function refuse(code, detail = '') { throw Object.assign(new Error(`${code}${detail ? `: ${detail}` : ''}`), { code }) }
export const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export const safePath = value => typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9._/-]*$/.test(value) && value.split('/').every(s => s && !s.startsWith('.') && !['__proto__', 'constructor', 'prototype'].includes(s))
export function exactKeys(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || canonical(Object.keys(value).sort()) !== canonical([...keys].sort())) refuse('invalid_fields', keys.join(','))
}
export function filePins(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || !Object.keys(value).length) refuse('invalid_file_pins')
  for (const [p, hash] of Object.entries(value)) if (!safePath(p) || !digest(hash)) refuse('invalid_file_pin', p)
}
export function verifyFiles(bytes, pins) {
  filePins(pins)
  const actual = Object.fromEntries([...bytes].map(([p, b]) => [p, sha256(b)]))
  if (canonical(actual) !== canonical(pins)) refuse('file_closure_mismatch')
}

export function readInstrumentedArchive(archive, pin) {
  exactKeys(pin, ['archive_sha256', 'files'])
  filePins(pin.files)
  if (!Buffer.isBuffer(archive) || archive.length > 32 * 1024 * 1024 || !digest(pin.archive_sha256)) refuse('archive_digest_mismatch')
  archive = Buffer.from(archive) // Hash and parse the same private snapshot.
  if (sha256(archive) !== pin.archive_sha256) refuse('archive_digest_mismatch')
  let tar
  try { tar = gunzipSync(archive, { maxOutputLength: 64 * 1024 * 1024 }) } catch { refuse('invalid_bounded_gzip') }
  if (tar.length % 512) refuse('invalid_tar_length')
  const bytes = new Map()
  const text = (h, a, b) => {
    const field = h.subarray(a, b), end = field.indexOf(0)
    if (end >= 0 && field.subarray(end).some(v => v !== 0)) refuse('invalid_tar_string')
    return field.subarray(0, end < 0 ? field.length : end).toString('utf8')
  }
  let ended = false
  for (let at = 0; at + 512 <= tar.length;) {
    const h = tar.subarray(at, at + 512)
    if (h.every(b => b === 0)) {
      if (at + 1024 > tar.length || tar.subarray(at).some(b => b !== 0)) refuse('invalid_tar_end')
      ended = true; break
    }
    // The checksum field permits a trailing space after its NUL, unlike path fields.
    const sumText = h.subarray(148, 156).toString('ascii').replace(/\0/g, '').trim()
    const sizeText = h.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim()
    if (!/^[0-7]+$/.test(sumText) || !/^[0-7]+$/.test(sizeText)) refuse('invalid_tar_number')
    const size = parseInt(sizeText, 8)
    const checksum = [...h].reduce((sum, b, i) => sum + (i >= 148 && i < 156 ? 32 : b), 0)
    if (checksum !== parseInt(sumText, 8) || at + 512 + Math.ceil(size / 512) * 512 > tar.length) refuse('invalid_tar_checksum_or_size')
    if (text(h, 257, 263) !== 'ustar' || !['0', ''].includes(text(h, 156, 157)) || text(h, 157, 257)) refuse('nonregular_tar_entry')
    const prefix = text(h, 345, 500), name = `${prefix ? prefix + '/' : ''}${text(h, 0, 100)}`
    if (!name.startsWith('package/') || !safePath(name.slice(8))) refuse('unsafe_archive_path', name)
    const p = name.slice(8)
    if (bytes.has(p)) refuse('duplicate_archive_entry', p)
    if (/(^|\/)(?:opencode\.jsonc?|AGENTS\.md|CLAUDE\.md)$/.test(p)) refuse('project_config_in_archive', p)
    bytes.set(p, Buffer.from(tar.subarray(at + 512, at + 512 + size)))
    at += 512 + Math.ceil(size / 512) * 512
  }
  if (!ended) refuse('truncated_archive')
  verifyFiles(bytes, pin.files)
  let pkg
  try { pkg = JSON.parse(bytes.get('package.json').toString('utf8')) } catch { refuse('invalid_package') }
  const rootExport = { '.': './index.js' }, readExport = { ...rootExport, './reads': { types: './service-interface/index.d.mts', import: './service-interface/index.mjs' } }
  const hasReads = canonical(pkg.exports) === canonical(readExport)
  if (pkg.name !== '@joe-broadhead/opencode-mem' || pkg.type !== 'module' || pkg.main !== './index.js' || (!hasReads && canonical(pkg.exports) !== canonical(rootExport)) || !Array.isArray(pkg.files) || !pkg.files.length) refuse('invalid_package_contract')
  if (hasReads) {
    if (canonical(pkg.bin) !== canonical({ 'memory-read': './service-interface/cli.mjs' }) || !['index.d.mts', 'index.mjs', 'cli.mjs'].every(p => bytes.has(`service-interface/${p}`))) refuse('invalid_package_read_interface')
  } else if (pkg.bin !== undefined) refuse('invalid_package_read_interface')
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) {
    if (pkg[field] && Object.keys(pkg[field]).length) refuse('unapproved_package_dependencies')
  }
  const positive = [], excluded = []
  for (const entry of pkg.files) {
    if (typeof entry !== 'string') refuse('unsupported_package_files')
    const negative = entry.startsWith('!'), p = (negative ? entry.slice(1) : entry).replace(/\/$/, '')
    if (!safePath(p)) refuse('unsupported_package_files')
    ;(negative ? excluded : positive).push(p)
  }
  if (!positive.length) refuse('unsupported_package_files')
  const matches = (p, root) => p === root || p.startsWith(root + '/')
  for (const p of bytes.keys()) {
    if (excluded.some(root => matches(p, root)) || (!['package.json', 'LICENSE', 'README.md'].includes(p) && !positive.some(root => matches(p, root)))) refuse('outside_package_files', p)
  }
  for (const p of ['index.js', 'src/index.js', 'src/runtime.js']) if (!bytes.has(p)) refuse('missing_factory_closure', p)
  return bytes
}
