# tools-get-coworker-connections
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_coworker_connections (which colleagues are connected)
- Decision tested: A which-colleagues-know-them question is one connections read, with Affinity's score labelled
- Data check: {{target:affinity.company}} has at least one coworker connection
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which of my colleagues are connected to {{target:affinity.company}}?

## Items
- [AFF-TR01] blocker · It used get_coworker_connections once.
  evidence: call:affinity.get_coworker_connections#1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_coworker_connections#1 args.company_id present
- [AFF-OC01] major · The answer names the colleagues and says the score is Affinity's.
  evidence: text:any matches /(Affinity|score|connected)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
