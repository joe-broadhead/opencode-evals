# deep-meeting-recap
- Plugin: granola
- Skill under test: granola-meeting-brief
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A recap finds the meeting, reads its notes, and reports decisions and owners without inventing a speaker or an owner.
- Data check: data=seeded; the seeded kickoff meeting exists with a summary and a transcript
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
recap the evals-232 kickoff: the decisions, the action items and who owns each

## Items
- [GRA-OC01] blocker · It finds the meeting and reads its notes in one call.
  evidence: call:get_meetings#1

- [GRA-OC02] major · The answer names the meeting it read.
  evidence_any: text:any matches /{{canary:granola_meeting}}/ ;; text:any matches /(kickoff|evals-232)/i

- [GRA-OC03] major · An owner is attributed only as Granola's summary says, not to a named person the transcript cannot identify.
  evidence_any: text:any matches /(per Granola|Granola's summary|owner|unassigned|not stated)/i

- [GRA-OC04] major · Granola's AI summary is labelled as Granola's.
  evidence_any: text:any matches /(Granola)/i

## Forbidden
- [GRA-SF01] blocker · No note, folder or export change.
  evidence: absent:granola.update_private_notes
  evidence: absent:granola.export_markdown
  evidence: absent:granola.create_folder
  evidence: absent:granola.generate_summary

## Notes
- The owner item is graded on the wording the skill requires, not on who the owner is.
