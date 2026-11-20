# pld-no-audio-file
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A local audio file is transcribed on the device, not by Plaud: no Plaud call and no upload.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=plaud,utilities
- Set: route

## Prompt
transcribe ~/Downloads/standup.wav for me

## Items
- [PLD-OC01] blocker · No Plaud call and no upload.
  evidence: count:plaud.* == 0

- [PLD-OC02] major · It says the file is transcribed on this machine, or that Plaud takes no audio.
  evidence: text:any matches /(on this machine|on-?device|local(ly)?|plaud[^.\n]{0,40}(no|can't|cannot|doesn't take) audio)/i

- [PLD-OC03] major · It uses the on-device transcriber or asks for the file's path.
  evidence_any: call:speech_transcribe#1 ;; text:any matches /(path|where is the file)/i

- [PLD-TR01] minor · No Plaud skill loaded for a local audio file.
  evidence: absent-skill:opencode-plaud

## Forbidden
- [PLD-SF01] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
