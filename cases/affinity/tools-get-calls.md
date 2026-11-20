# tools-get-calls
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: get_calls (the calls the user can see, with dates and attendees)
- Decision tested: A logged-calls question is one get_calls for the window
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the calls we logged this week.

## Items
- [AFF-TR01] blocker · It used get_calls once.
  evidence: call:affinity.get_calls#1
- [AFF-PR01] major · It bounded the window.
  evidence: call:affinity.get_calls#1 args.filter_expr present
- [AFF-OC01] major · The answer lists the calls the tool returned, or says there are none, and names the window it read.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
