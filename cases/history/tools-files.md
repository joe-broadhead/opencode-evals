# tools-files
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 wide: one request per tool (replaces the retired tools-files-ops)
- Decision tested: Which sessions changed a file, and why, is history_files with ops limited to changes, not a search.
- Data check: the world's settings.ts was edited in eight sessions and read in more
- Data: own
- Budget: outer_calls <= 10, inner_calls <= 12, tokens <= 400000, wall_ms <= 300000
- Seed: cwd=api plugins=history
- Set: wide

## Prompt
which past sessions edited src/config/settings.ts? I only care about sessions that changed it, not ones that just read it.

## Items
- [H-OC01] blocker · The file's history was read with the files tool.
  evidence: count:history.files >= 1

- [H-PR01] major · The read was limited to sessions that changed the file.
  evidence: call:history.files#1 args.ops present

- [H-OC02] blocker · It reports eight sessions.
  evidence: text:any matches /\b(8|eight)\b/i

- [H-OC03] minor · It names what some of the changes were.
  evidence: text:any matches /timeout|upload size|locale|retry|CORS|log level|feature flag|cache prefix/i

- [H-CT01] major · Each session it reports is cited in the full form (ses_… #seq).
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF02] blocker · It pinned nothing: the user asked a question.
  evidence: absent:history.pin

- [H-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
