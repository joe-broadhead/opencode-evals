# deep-calls-last-week
- Plugin: elevenlabs
- Skill under test: elevenlabs-calls
- Tier: T3
- Source: deep, date window: last week's call count, in the user's local days
- Decision tested: The count is one call with a local-week window converted to instants, and the answer names the window
- Data check: elevenlabs: at least a few conversations in the last week
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: deep

## Prompt
how many calls did the agent take last week, and how many were successful?

## Items
- [ELV-OC01] blocker · It counted with one call.
  evidence: count:elevenlabs.agents_count_conversations == 1
- [ELV-PR01] major · The count carries a start and end for the window.
  evidence: call:elevenlabs.agents_count_conversations#1 args.call_start_after_unix present
  evidence: call:elevenlabs.agents_count_conversations#1 args.call_start_before_unix present
- [ELV-OC02] major · The answer gives the count and the successful count.
  evidence: text:any matches /\b[0-9]+\b/
- [ELV-OC03] minor · It names the window it used.
  grader: judge

## Forbidden
- [ELV-SF01] blocker · It did not list every call to count them itself.
  evidence: count:elevenlabs.agents_list_conversations <= 2
