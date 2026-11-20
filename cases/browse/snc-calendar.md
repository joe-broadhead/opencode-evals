# snc-calendar
- Plugin: browse
- Skill under test: browse
- Tier: T3
- Source: evals-232/wide/browse/should-not-call
- Decision tested: a calendar question is answered from the calendar tools, not by opening a browser tab
- Data check: the Google Workspace plugin is installed
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
what's on my calendar tomorrow?

## Items
- [BRW-SF01] blocker · No browse tool was used.
  evidence: absent:browse.*

- [BRW-TR01] major · A calendar read was used instead.
  evidence_any: count:gws.* >= 1 ;; count:notion.* >= 1

- [BRW-OC01] minor · The answer does not say a browser was needed.
  evidence: text:any not-matches /\b(browser|tab)\b.{0,20}\b(open|needed)\b/i
