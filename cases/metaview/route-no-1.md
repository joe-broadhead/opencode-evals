# route-no-1
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: should-not-call: a general calendar question is the calendar's, not Metaview's
- Decision tested: A what-is-on-my-calendar question reaches no Metaview tool
- Data check: the user's calendar holds at least one event tomorrow
- Seed: plugins=metaview,gws utc-hours=9-17
- Data: candidate
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: route

## Prompt
what's on my calendar tomorrow?

## Items
- [MV-RT01] blocker · No Metaview tool was called.
  evidence: absent:metaview.*
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

- [MV-OC02] major · It read the calendar with the Google Workspace tools.
  evidence: call:gws.read#1 args.operation matches /^calendar\./

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
