import { posix } from 'node:path'
import { builtinModules } from 'node:module'
import { sha256 } from '../util/canonical.mjs'
import { refuse, safePath } from './mem-instrumented-archive.mjs'

// Deliberately conservative lexical dialect, not a JavaScript parser or sandbox.
// Unsupported templates, regex/division and escaped identifiers fail closed.
// Strings/comments never contribute imports. Specifier escapes are refused.
function tokens(source) {
  const out = []
  for (let i = 0; i < source.length;) {
    const start = i, c = source[i]
    if (/\s/.test(c)) { i++; continue }
    if (source.startsWith('//', i)) {
      i += 2
      while (i < source.length && !/[\n\r\u2028\u2029]/.test(source[i])) i++
      continue
    }
    if (source.startsWith('/*', i)) { i = source.indexOf('*/', i + 2); if (i < 0) refuse('unsupported_module_syntax'); i += 2; continue }
    if (c === '"' || c === "'") {
      let escaped = false; i++
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\n' || source[i] === '\r') refuse('unsupported_module_syntax')
        if (source[i] === '\\') { escaped = true; i++ }
        i++
      }
      if (i >= source.length) refuse('unsupported_module_syntax')
      out.push({ value: source.slice(start + 1, i), string: true, escaped, start, end: ++i }); continue
    }
    if (c === '`' || c === '/' || c === '\\' || c.charCodeAt(0) > 127) refuse('unsupported_module_syntax')
    if (/[A-Za-z_$]/.test(c)) {
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) i++
      out.push({ value: source.slice(start, i), start, end: i }); continue
    }
    out.push({ value: c, start, end: ++i })
  }
  return out
}

export function checkClosure(bytes, { node_builtins = [], dependency_profiles = [], arm = null, requireFactory = false } = {}) {
  if (!Array.isArray(node_builtins) || new Set(node_builtins).size !== node_builtins.length || node_builtins.some(p => !p.startsWith('node:') || !builtinModules.includes(p.slice(5)))) refuse('invalid_builtin_allowance')
  // Known payload conflict has a stable diagnostic even when unrelated syntax is
  // outside this version's conservative dialect. This never grants permission.
  for (const [p, data] of bytes) {
    if (/\.(?:cjs|node|wasm|sh)$/.test(p)) refuse('unsupported_executable_member', p)
    if (!/\.(?:m?js)$/.test(p)) continue
    if (data.includes(Buffer.from('@opencode/util/global')) && !dependency_profiles.some(profile => profile.arm === arm && profile.issuer.path === p)) refuse('unapproved_external_dependency', p)
  }
  const used = new Set()
  for (const [p, data] of bytes) {
    if (!/\.(?:m?js)$/.test(p)) continue
    const source = data.toString('utf8'), ts = tokens(source)
    if (requireFactory && p === 'src/index.js') {
      const factory = ['export', 'function', 'createMemoryPlugin', '(']
      if (!ts.some((_, i) => factory.every((name, n) => ts[i + n]?.value === name && !ts[i + n]?.string))) refuse('missing_factory_export')
    }
    for (let i = 0; i < ts.length; i++) {
      const token = ts[i]
      if (token.string || !['import', 'from'].includes(token.value)) continue
      let spec = ts[i + 1], dynamic = false, end
      if (token.value === 'import' && spec?.value === '(') {
        dynamic = true; spec = ts[i + 2]; end = ts[i + 3]
        if (!spec?.string || end?.value !== ')') refuse('nonliteral_or_extended_dynamic_import', p)
      } else if (!spec?.string) {
        if (token.value === 'from') continue
        if (!spec || spec.value === '.') refuse('unsupported_module_syntax', p)
        // Named/default imports must have a literal from clause before ';'.
        const tail = ts.slice(i + 1).findIndex(t => t.value === ';')
        const clause = ts.slice(i + 1, tail < 0 ? undefined : i + 1 + tail)
        if (!clause.some((t, n) => t.value === 'from' && clause[n + 1]?.string)) refuse('unsupported_module_syntax', p)
        continue
      }
      if (spec.escaped) refuse('escaped_import_specifier', p)
      const name = spec.value
      if (dynamic) {
        const offset = Buffer.byteLength(source.slice(0, token.start)), site = Buffer.from(source.slice(token.start, end.end))
        const index = dependency_profiles.findIndex(profile => profile.arm === arm && profile.specifier === name && profile.issuer.path === p && profile.issuer.sha256 === sha256(data) && profile.site.offset === offset && profile.site.length === site.length && profile.site.sha256 === sha256(site))
        if (index < 0) refuse('unapproved_external_dependency', p)
        used.add(index); i += 3; continue
      }
      if (node_builtins.includes(name)) continue
      if (!name.startsWith('./') && !name.startsWith('../')) refuse('unapproved_external_dependency', name)
      const target = posix.normalize(posix.join(posix.dirname(p), name))
      if (!safePath(target) || !/\.(?:m?js)$/.test(target) || !bytes.has(target)) refuse('relative_import_escape_or_missing', target)
    }
  }
  for (let i = 0; i < dependency_profiles.length; i++) if (dependency_profiles[i].arm === arm && !used.has(i)) refuse('unused_dependency_profile')
}
