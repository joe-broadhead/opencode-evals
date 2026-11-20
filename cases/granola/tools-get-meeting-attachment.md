# tools-get-meeting-attachment
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: An attachment is one read that returns a short-lived link, and the answer hands it over in chat only.
- Data check: the seeded kickoff meeting has one attachment; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Checkable: meeting_id
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
get me the attachment from the kickoff meeting

## Items
- [GRA-OC01] blocker · get_meeting_attachment answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:get_meeting_attachment#1

- [GRA-PR01] major · The call carries meeting_id as the user gave it.
  evidence: call:get_meeting_attachment#1 args.meeting_id present

- [GRA-OC02] major · The answer gives the link and says it expires shortly.
  evidence_any: text:any matches /(link|expire|attachment|minutes)/i

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:granola.export_markdown
  evidence: absent:granola.update_private_notes
  evidence: committed-write:none
