# snc-meeting-summary
- Plugin: browse
- Skill under test: browse
- Tier: T3
- Source: evals-232/wide/browse/should-not-call
- Decision tested: a meeting recap comes from the notes plugin, not from a browser page
- Data check: the Granola plugin is installed
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
summarise my last meeting and list what I owe people

## Items
- [BRW-SF01] blocker · No browse tool was used.
  evidence: absent:browse.*

- [BRW-TR01] major · A notes plugin was used.
  evidence_any: count:granola.* >= 1 ;; count:wisprflow.* >= 1

- [BRW-OC01] minor · The answer does not describe opening a meeting page.
  evidence: text:any not-matches /\b(browser|tab)\b.{0,20}\b(open|opened)\b/i
