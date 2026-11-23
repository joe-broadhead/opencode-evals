import { canonical } from '../util/canonical.mjs'
import { refuse } from './mem-instrumented-archive.mjs'

// Apply the single bound, reviewed, context-bearing patch to both parent byte maps.
// No shell/git patch execution, fuzzy matching, file creation, or path selection.
export function verifyInjection(parent, derivative, patch) {
  const lines = patch.toString('utf8').split('\n')
  if (lines.pop() !== '') refuse('invalid_injection_patch')
  const changed = [], result = new Map(parent)
  for (let i = 0; i < lines.length;) {
    const file = /^diff --git a\/(src\/(?:index|runtime)\.js) b\/\1$/.exec(lines[i++])?.[1]
    if (!file || changed.includes(file) || lines[i++] !== `--- a/${file}` || lines[i++] !== `+++ b/${file}`) refuse('invalid_injection_patch')
    changed.push(file)
    const original = parent.get(file)?.toString('utf8').split('\n')
    if (!original || original.pop() !== '') refuse('unsupported_patch_source')
    const output = []; let cursor = 0, hunks = 0
    while (i < lines.length && !lines[i].startsWith('diff --git ')) {
      const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/.exec(lines[i++])
      if (!h) refuse('invalid_patch_hunk')
      const start = Number(h[1]) - 1, oldCount = Number(h[2] ?? 1), newStart = Number(h[3]) - 1, newCount = Number(h[4] ?? 1)
      if (start < cursor || start > original.length) refuse('invalid_patch_offset')
      output.push(...original.slice(cursor, start)); cursor = start
      if (output.length !== newStart) refuse('invalid_patch_offset')
      let old = 0, added = 0
      while (i < lines.length && !lines[i].startsWith('@@ ') && !lines[i].startsWith('diff --git ')) {
        const row = lines[i++], mark = row[0], text = row.slice(1)
        if (![' ', '+', '-'].includes(mark)) refuse('invalid_patch_line')
        if (mark !== '+') { if (original[cursor++] !== text) refuse('patch_context_mismatch'); old++ }
        if (mark !== '-') { output.push(text); added++ }
      }
      if (old !== oldCount || added !== newCount) refuse('patch_hunk_count_mismatch')
      hunks++
    }
    if (!hunks) refuse('empty_patch')
    output.push(...original.slice(cursor)); result.set(file, Buffer.from(output.join('\n') + '\n'))
  }
  if (canonical(changed) !== canonical(['src/index.js', 'src/runtime.js']) || canonical([...parent.keys()].sort()) !== canonical([...derivative.keys()].sort())) refuse('production_patch_file_set')
  for (const [p, bytes] of result) if (!bytes.equals(derivative.get(p))) refuse('production_patch_mismatch', p)
  for (const p of changed) if (parent.get(p).equals(derivative.get(p))) refuse('unchanged_production_patch', p)
}
