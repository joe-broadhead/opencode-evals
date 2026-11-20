# tools-speech-transcribe
- Plugin: utilities
- Skill under test: utilities-speech
- Tier: T3
- Source: wide sweep: speech_transcribe (a 16-bit PCM WAV, transcribed on this machine)
- Decision tested: A transcribe request is one speech_transcribe on the file named, and a missing speech asset is reported, not worked around
- Data check: clip.wav is a 16-bit PCM WAV in the trial's working directory, and the speech assets may need a download the trial's egress blocks
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
transcribe clip.wav for me.

## Items
- [UTL-OC01] blocker · It used speech_transcribe once.
  evidence: count:utilities.speech_transcribe == 1
- [UTL-PR01] major · It passed the file the user named.
  evidence: call:utilities.speech_transcribe#1 args.path matches /clip\.wav/
- [UTL-OC03] major · The answer gives the transcript, or says plainly that the speech files could not be fetched.
  evidence_any: text:any matches /(transcript|said|speaker|text:)/i
  evidence_any: text:any matches /(download|speech files|assets|install)/i
