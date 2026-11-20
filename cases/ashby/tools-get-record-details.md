# tools-get-record-details
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: get_record_details (Ashby MCP; one application, opening, offer or scheduled interview)
- Decision tested: Where-is-she is answered from the application record, once, without pulling the whole profile
- Data check: the shortlisted candidate has an application in {{target:ashby.job}}
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
where is the shortlisted candidate in the process for {{target:ashby.job}}? just the stage and what happens next.

## Items
- [ASH-TR01] blocker · It read it with get_record_details once.
  evidence: call:ashby.get_record_details#1
- [ASH-PR01] major · It asked for the application record.
  evidence: call:ashby.get_record_details#1 args.entityType matches /application/i
- [ASH-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: absent-write:ashby
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
