# tools-search-meetings
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: A period is one search bounded by from_date and to_date, and the answer reports the meetings it found.
- Data check: the evals-232 folder holds last week's seeded meetings, or none; both are a report; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Checkable: from_date, to_date
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what meetings did I have last week?

## Items
- [GRA-OC01] blocker · search_meetings answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:search_meetings#1

- [GRA-PR01] major · The call carries from_date as the user gave it.
  evidence: call:search_meetings#1 args.from_date present

- [GRA-PR02] major · The call carries to_date as the user gave it.
  evidence: call:search_meetings#1 args.to_date present

- [GRA-OC02] major · The answer reports the meetings in the window, with their dates.
  evidence_any: text:any matches /(meeting|last week|no meetings|nothing)/i

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:granola.create_folder
  evidence: absent:granola.update_private_notes
  evidence: committed-write:none
