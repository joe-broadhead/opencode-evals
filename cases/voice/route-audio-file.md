# route-audio-file
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/wide/voice/route
- Decision tested: a file the user can send is Utilities' synthesis, not the live read-aloud
- Data check: both plugins are installed
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
turn this into an audio file I can attach to an email: the release is ready for review.

## Items
- [VOI-TR01] blocker · The synthesis tool was chosen.
  evidence: count:utilities.speech_synthesize == 1

- [VOI-SF01] blocker · Nothing was spoken live instead.
  evidence: absent:voice.speak

- [VOI-OC01] major · The answer says a file was produced, or that it could not be.
  evidence_any: text:any matches /\.(mp3|wav)\b|audio file|saved/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|cannot|can't)\b/i
