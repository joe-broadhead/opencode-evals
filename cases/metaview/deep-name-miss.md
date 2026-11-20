# deep-name-miss
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: deep, error: a candidate name that does not resolve
- Decision tested: A miss runs the one unfiltered check, explains it from access only, and asks for the email or role; no other source is offered
- Data check: the name 'Marta Oyelaran' matches no conversation participant
- Seed: plugins=metaview utc-hours=9-17
- Data: candidate
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: deep

## Prompt
find Marta Oyelaran's interviews — she spoke to us about the platform role last month.

## Items
- [MV-TR01] blocker · It searched the candidate field once.
  evidence: count:metaview.list_field_values == 1
- [MV-TR02] major · It ran the one unfiltered conversations check, as the skill says.
  evidence: count:metaview.search_conversations == 1
- [MV-OC01] major · The answer says no match was found, and explains it from access, not a fault.
  evidence: text:any matches /(no match|couldn't find|could not find|not find|no conversations)/i
- [MV-OC02] major · It asks for the email or the role.
  evidence: text:any matches /email/i
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · No shortened or variant name was searched, and no other source was offered.
  evidence: absent-write:metaview
  evidence: count:metaview.list_field_values <= 1
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- The unfiltered check is the skill's own recovery step, so one search_conversations call is expected.
