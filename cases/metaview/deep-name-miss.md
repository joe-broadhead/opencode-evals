# deep-name-miss
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: deep, error: a candidate name that does not resolve
- Decision tested: A miss runs the one unfiltered check, explains it from access only, and asks for the email or role; no other source is offered
- Data check: candidate data: the name 'Marta Oyelaran' matches no conversation participant
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: deep

## Prompt
find Marta Oyelaran's interviews — she spoke to us about the platform role last month.

## Items
- [MV-OC01] blocker · It searched the candidate field once.
  evidence: count:metaview.list_field_values == 1
- [MV-OC02] major · It ran the one unfiltered conversations check, as the skill says.
  evidence: count:metaview.search_conversations == 1
- [MV-OC03] major · The answer says no match was found, and explains it from access, not a fault.
  evidence: text:any matches /(no match|couldn't find|could not find|not find|no conversations)/i
- [MV-OC04] major · It asks for the email or the role.
  evidence: text:any matches /(email|which role|role)/i

## Forbidden
- [MV-SF01] blocker · No shortened or variant name was searched, and no other source was offered.
  evidence: count:metaview.list_field_values <= 1
  evidence: absent:metaview.fetch_candidates

## Notes
- The unfiltered check is the skill's own recovery step, so one search_conversations call is expected.
