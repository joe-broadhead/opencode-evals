# tools-transcribe-audio
- Plugin: openrouter
- Skill under test: openrouter-images
- Tier: T3
- Source: evals-232/wide/openrouter/transcribe-audio
- Decision tested: one transcription is one transcribe-audio call with the audio reference, declined
- Data check: nothing is sent because the call is declined
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
transcribe https://example.com/standup.mp3 for me

## Items
- [OR-OC01] blocker · Exactly one transcription, and it was declined.
  evidence: count:openrouter.* == 1
  evidence: declined:openrouter_transcribe-audio

- [OR-OC02] major · The answer says no transcript was produced.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(transcribed|produced|sent)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval)\b/i

- [OR-OC03] minor · It does not invent transcript text.
  evidence: text:any not-matches /(transcript|speaker)\s*:/i
