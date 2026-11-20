# deep-calls-last-week
- Plugin: elevenlabs
- Skill under test: elevenlabs-calls
- Tier: T3
- Source: deep, date window: last week's call count, in the user's local days
- Decision tested: The count is one call with a local-week window converted to instants, and the answer names the window
- Data check: at least a few conversations in the last week
- Seed: plugins=elevenlabs utc-hours=9-17
- Data: real
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: deep

## Prompt
how many calls did {{target:elevenlabs.agent}} take last week, and how many were successful?

## Items
- [ELV-TR01] blocker · It counted with one call.
  evidence: count:elevenlabs.agents_count_conversations == 1
- [ELV-PR01] major · The count carries a start and end for the window.
  evidence: call:elevenlabs.agents_count_conversations#1 args.call_start_after_unix matches /^1[0-9]{9}$/
  evidence: call:elevenlabs.agents_count_conversations#1 args.call_start_before_unix matches /^1[0-9]{9}$/
- [ELV-OC01] minor · The answer gives the count and the successful count the tool returned.
  grader: judge
- [ELV-OC02] minor · It names the window it used.
  grader: judge
- [ELV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · It did not list every call to count them itself.
  evidence: absent-write:elevenlabs
  evidence: count:elevenlabs.agents_list_conversations <= 2
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
