# tools-portfolio-check-in
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: portfolio_check_in (ranks portfolio companies by attention)
- Decision tested: A who-needs-a-check-in request calls the routine once
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which portfolio companies need a check-in?

## Items
- [AFF-TR01] blocker · It used portfolio_check_in once.
  evidence: call:affinity.portfolio_check_in#1
- [AFF-OC01] major · The answer names the companies that need a check-in and gives a reason for each.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
