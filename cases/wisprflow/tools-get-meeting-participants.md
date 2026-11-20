# tools-get-meeting-participants
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: The full attendee list comes from get_meeting_participants_enriched, not from a five-attendee search result.
- Data check: the round's Wispr Flow meeting exists (owner row 25), with a transcript and a summary
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
who was in the Wispr Flow meeting {{target:wisprflow.meeting}}? I need the full list, not just the first few.

## Items
- [WF-OC01] blocker · Exactly one participants call.
  evidence: count:get_meeting_participants_enriched == 1

- [WF-PR01] major · The meeting id the user gave was passed.
  evidence: call:get_meeting_participants_enriched#1 args.meeting_id present

- [WF-OC02] major · The answer lists attendees and says which one is the user.
  evidence: text:any matches /(you|yourself|is_mine|self)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-EF01] blocker · No profile enrichment for a plain attendee list.
  evidence: absent:get_participant_contacts

- [WF-SF02] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
