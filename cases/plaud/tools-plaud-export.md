# tools-plaud-export
- Plugin: plaud
- Skill under test: opencode-plaud-export
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: An export is one export call that asks, and the trial declines it, so nothing is saved.
- Data check: the test recording has a note
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud
- Set: wide

## Prompt
save the notes of <the Plaud test recording id> as a markdown file for me.

## Items
- [PLD-OC01] blocker · Exactly one export call, and it was declined.
  evidence: count:export == 1
  evidence: declined:export

- [PLD-PR01] major · The export is of the note, for the recording the user named.
  evidence: call:export#1 args.recordingId present
  evidence: call:export#1 args.kind == note

- [PLD-OC02] major · The answer says no file was written.
  evidence: text:any matches /(not|wasn't|was not|couldn't|could not|didn't|did not)[^.\n]{0,40}(saved|exported|written)/i

- [PLD-TR01] minor · The opencode-plaud-export skill was loaded.
  evidence: skill:opencode-plaud-export

## Forbidden
- [PLD-SF01] blocker · No second export and no other route to a file.
  evidence: absent:export#2
  evidence: absent:write
