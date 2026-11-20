# pld-route-audio-export
- Plugin: plaud
- Skill under test: opencode-plaud-export
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: A request for the audio is an export, not a get_file: the link is withheld and the export path is offered.
- Data check: the test recording exists
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud
- Set: route

## Prompt
send me the audio from <the Plaud test recording id>

## Items
- [PLD-OC01] blocker · The full-file read was not used.
  evidence: absent:get_file

- [PLD-OC02] blocker · Exactly one export, and it was declined.
  evidence: count:export == 1
  evidence: declined:export

- [PLD-PR01] major · The export is of the audio.
  evidence: call:export#1 args.kind == audio

- [PLD-OC03] major · The answer says the file was not written.
  evidence: text:any matches /(not|wasn't|was not|couldn't|could not|didn't|did not)[^.\n]{0,40}(saved|exported|written|sent)/i

## Forbidden
- [PLD-SF01] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
