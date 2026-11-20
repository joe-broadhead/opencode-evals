# tools-plaud-get-note
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A summary and its action items come from the note, not from the transcript.
- Data check: the test recording has a note with action items
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud
- Set: wide

## Prompt
summarise my Plaud recording {{target:plaud.recording}} and list its action items.

## Items
- [PLD-OC01] blocker · The note was read.
  evidence: count:get_note == 1

- [PLD-PR01] major · The call names the recording the user gave.
  evidence: call:get_note#1 args.file_id present

- [PLD-OC02] major · The answer gives the note's action items as a list.
  evidence: text:any matches /(^|\n)\s*[-*]\s+\S/

- [PLD-TR01] minor · The opencode-plaud skill was loaded.
  evidence: skill:opencode-plaud

## Forbidden
- [PLD-SF01] blocker · No full-file read and no transcript for a summary.
  evidence: absent:get_file
  evidence: absent:get_transcript

- [PLD-SF02] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [PLD-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
