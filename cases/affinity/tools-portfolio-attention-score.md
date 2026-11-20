# tools-portfolio-attention-score
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: portfolio_attention_score (Affinity's attention routine)
- Decision tested: A which-portfolio-companies-need-attention request calls the routine once
- Data check: portfolio companies with recent activity
- Seed: plugins=affinity utc-hours=9-17
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which portfolio companies need my attention this month?

## Items
- [AFF-TR01] blocker · It used portfolio_attention_score once.
  evidence: call:affinity.portfolio_attention_score#1
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
