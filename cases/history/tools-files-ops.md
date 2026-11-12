# tools-files-ops
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: hot-file filler (settings.ts edited in 8 sessions, read in more)
- Decision tested: history_files with ops: only the sessions that CHANGED a file, not those that merely read it.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 300000

## Prompt
which past sessions edited src/config/settings.ts? I only care about sessions that changed it, not ones that just read it

## Items
- [H-OC01] blocker · It reports 8 sessions.
  evidence: text:any matches /\b8\b|eight/i

- [H-OC02] major · It used files with ops limited to changes.
  evidence: call:history.files#1 args.ops present

- [H-OC03] minor · It names a few of the setting changes (timeout, upload size, locale, retry, CORS...).
  evidence: text:any matches /timeout|upload size|locale|retry|CORS|log level|feature flag|cache prefix/i

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:apply_patch
