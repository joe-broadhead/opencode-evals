# tools-get-transcript-fragments
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_transcript_fragments (the first page of an AI Notetaker transcript)
- Decision tested: A what-did-they-say question is one transcript page, reported in the user's own words
- Data check: {{target:affinity.company}} has an AI Notetaker note with a transcript
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide
- Status: deferred

## Prompt
what did {{target:affinity.company}} say about their raise in the last call? use the transcript.

## Items
- [AFF-TR01] blocker · It used get_transcript_fragments once.
  evidence: call:affinity.get_transcript_fragments#1
- [AFF-PR01] major · It read the transcript of the note it found.
  evidence: call:affinity.get_transcript_fragments#1 args.transcript_id present
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- Deferred: no AI Notetaker note with a transcript is visible (20 Nov).
