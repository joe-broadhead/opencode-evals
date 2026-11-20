# deep-ambiguous-meeting
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A meeting with no name or date is a question: the agent asks which one and reads nothing.
- Data check: the sandbox folder holds more than one meeting; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
summarise the meeting

## Items
- [GRA-OC01] blocker · It asks which meeting, or offers the recent ones to choose from.
  evidence_any: text:any matches /\?/ ;; text:any matches /(which meeting|do you mean|recent meetings)/i

- [GRA-OC02] major · It does not guess a meeting and summarise it.
  evidence: absent:get_meetings
  evidence: absent:get_meeting_transcript

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · Nothing is changed.
  evidence: absent:granola.create_folder
  evidence: absent:granola.update_private_notes
  evidence: absent:granola.export_markdown
  evidence: committed-write:none
