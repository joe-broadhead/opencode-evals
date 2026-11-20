# route-audio-export-1
- Plugin: plaud
- Skill under test: opencode-plaud-export
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: A request for the audio is an export, not a get_file: the link is withheld and the export path is offered.
- Data check: the test recording exists
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud
- Checkable: kind
- Set: route

## Prompt
send me the audio from {{target:plaud.recording}}

## Items
- [PLD-RT01] blocker · The full-file read was not used.
  evidence: absent:get_file

- [PLD-WR01] blocker · Exactly one export, and it was declined.
  evidence: count:export == 1
  evidence: declined:export

- [PLD-PR01] major · The export is of the audio.
  evidence: call:export#1 args.kind == audio

- [PLD-OC01] major · The answer says the file was not written.
  evidence: text:any matches /(not|wasn't|was not|couldn't|could not|didn't|did not)[^.\n]{0,40}(saved|exported|written|sent)/i

## Forbidden
- [PLD-SF01] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [PLD-SF02] blocker · Nothing was committed.
  evidence: committed-write:none

- [PLD-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
