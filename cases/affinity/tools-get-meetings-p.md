# tools-get-meetings-p
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-get-meetings (lane L6b)
- Decision tested: A what-meetings question is one get_meetings for the window, and it says this is the CRM's copy
- Data check: meetings logged in the last week
- Seed: plugins=affinity utc-hours=9-17
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide, twin

## Prompt
which calls and meetings did the CRM record for the previous week?

## Items
- [AFF-TR01] blocker · It used get_meetings once.
  evidence: call:affinity.get_meetings#1
- [AFF-PR01] major · It bounded the window.
  evidence: call:affinity.get_meetings#1 args.filter_expr present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
