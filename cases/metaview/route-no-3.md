# route-no-3
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: should-not-call: account help has no tool
- Decision tested: A how-do-I-change-my-password question reaches no Metaview tool
- Data check: none
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: route

## Prompt
how do I change my Metaview password?

## Items
- [MV-RT01] blocker · No Metaview tool was called.
  evidence: absent:metaview.*
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
