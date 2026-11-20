# tools-get-record-details
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: get_record_details (Ashby MCP; one application, opening, offer or scheduled interview)
- Decision tested: Where-is-she is answered from the application record, once, without pulling the whole profile
- Data check: {{target:ashby.candidate}} has an application in {{target:ashby.job}}
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
where is {{target:ashby.candidate}} in the process for {{target:ashby.job}}? just the stage and what happens next.

## Items
- [ASH-OC01] blocker · It read it with get_record_details once.
  evidence: count:ashby.get_record_details == 1
- [ASH-PR01] major · It asked for the application record.
  evidence: call:ashby.get_record_details#1 args.entityType matches /application/i
- [ASH-OC02] major · The answer names the stage and the next step.
  evidence: text:any matches /stage|next/i
