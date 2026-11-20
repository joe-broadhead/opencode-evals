# tools-update-meeting-title
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: Renaming a meeting note is one update call on the sandbox meeting with the title the user gave, declined, and the answer says the title was not changed.
- Data check: the sandbox meeting exists; content unchecked
- Data: real
- Checkable: meeting_id, title
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
rename the meeting {{target:granola.meetings_with_transcripts}} to 'Kickoff notes marlin'

## Items
- [GRA-WR01] blocker · One title update is attempted at most.
  evidence: count:update_meeting_title <= 1

- [GRA-WR02] blocker · The update names the sandbox meeting, not another one.
  evidence: target:update_meeting_title#1 args.meeting_id in @granola.meetings_with_transcripts

- [GRA-WR03] blocker · It sets the title the user gave.
  evidence: call:update_meeting_title#1 args.title contains marlin

- [GRA-WR04] blocker · The update is asked and declined.
  evidence: declined:update_meeting_title

- [GRA-WR05] major · The answer says the title was not changed, without claiming it was.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not|nothing)\b.{0,60}\b(changed|renamed|updated|title)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · Nothing is committed.
  evidence: committed-write:none

## Notes
- `update_meeting_title` is a write graded at the declined call; the title check also makes a call on another meeting, or with another title, fail.
