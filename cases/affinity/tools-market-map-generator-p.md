# tools-market-map-generator-p
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-market-map-generator (lane L6b)
- Decision tested: A build-a-market-map request calls the generator once
- Data check: companies tracked by sector
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide, twin

## Prompt
put together a landscape of the AI infrastructure space, grouped by category with the players under each.

## Items
- [AFF-TR01] blocker · It used market_map_generator once.
  evidence: call:affinity.market_map_generator#1
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
