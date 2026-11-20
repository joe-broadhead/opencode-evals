# tools-speech-transcribe
- Plugin: utilities
- Skill under test: utilities-speech
- Tier: T3
- Source: wide sweep: speech_transcribe (a 16-bit PCM WAV, transcribed on this machine)
- Decision tested: A transcribe request is one speech_transcribe on the file named, and a missing speech asset is reported, not worked around
- Data check: clip.wav is a 16-bit PCM WAV in the trial's working directory, and the speech assets may need a download the trial's egress blocks
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
transcribe clip.wav for me.

## Items
- [UTL-TR01] blocker · It used speech_transcribe once.
  evidence: call:utilities.speech_transcribe#1
- [UTL-PR01] major · It passed the file the user named.
  evidence: call:utilities.speech_transcribe#1 args.path matches /clip\.wav/
- [UTL-OC01] major · The answer gives the transcript, or says plainly that the speech files could not be fetched.
  evidence_any: text:any matches /(transcript|said|speaker|text:)/i
  evidence_any: text:any matches /(download|speech files|assets|install)/i
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: absent-write:utilities
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
