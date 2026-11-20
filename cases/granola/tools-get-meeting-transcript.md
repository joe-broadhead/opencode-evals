# tools-get-meeting-transcript
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: A detail the notes lack is read from the transcript's own chunks, and the answer reports it without naming speakers.
- Data check: the seeded kickoff transcript holds a passage about the budget; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Checkable: meeting_id
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what exactly was said about the budget in the kickoff?

## Items
- [GRA-OC01] blocker · get_meeting_transcript answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:get_meeting_transcript#1

- [GRA-PR01] major · The call carries meeting_id as the user gave it.
  evidence: call:get_meeting_transcript#1 args.meeting_id present

- [GRA-OC02] major · The answer reports what the passage says, without inventing a speaker's name.
  evidence_any: text:any matches /(budget|said|transcript)/i

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:granola.update_private_notes
  evidence: absent:granola.generate_summary
  evidence: committed-write:none
