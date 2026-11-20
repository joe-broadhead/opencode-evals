# tools-ready-to-raise-indicator
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: ready_to_raise_indicator (companies on a list due to raise again)
- Decision tested: A who-is-due-to-raise request calls the routine once
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which companies on list 424242 are due to raise again?

## Items
- [AFF-TR01] blocker · It used ready_to_raise_indicator once.
  evidence: call:affinity.ready_to_raise_indicator#1
- [AFF-OC01] major · The answer names the companies and the evidence.
  evidence: text:any matches /(raise|due|company|round)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
