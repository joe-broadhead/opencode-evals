# tools-get-transcript-fragments
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_transcript_fragments (the first page of an AI Notetaker transcript)
- Decision tested: A what-did-they-say question is one transcript page, reported in the user's own words
- Data check: affinity: {{target:affinity.company}} has an AI Notetaker note with a transcript
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what did {{target:affinity.company}} say about their raise in the last call? use the transcript.

## Items
- [AFF-OC01] blocker · It used get_transcript_fragments once.
  evidence: count:affinity.get_transcript_fragments == 1
- [AFF-PR01] major · It read the transcript of the note it found.
  evidence: call:affinity.get_transcript_fragments#1 args.transcript_id present
- [AFF-OC03] major · The answer reports what was said in its own words, labelled as Affinity's transcript.
  evidence: text:any matches /(said|raise|transcript|call)/i
