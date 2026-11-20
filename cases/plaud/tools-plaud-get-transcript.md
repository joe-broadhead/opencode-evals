# tools-plaud-get-transcript
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: What was said comes from one transcript page of the right block, cited to the recording and its date.
- Data check: the test recording has a transcript
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud
- Set: wide

## Prompt
in my Plaud recording <the Plaud test recording id>, what was said about the budget? quote it.

## Items
- [PLD-OC01] blocker · The transcript was read, one page at a time.
  evidence: count:get_transcript >= 1

- [PLD-OC02] major · The call names the recording and a block.
  evidence: call:get_transcript#1 args.file_id present

- [PLD-OC03] major · The answer quotes or closely reports the passage.
  evidence: text:any matches /(budget|cost|spend)/i

- [PLD-PR01] minor · It cites the recording by name or date.
  evidence: text:any matches /([0-9]{1,2} (Nov|November)|[0-9]{4}-[0-9]{2}-[0-9]{2})/

- [PLD-TR01] minor · The opencode-plaud skill was loaded.
  evidence: skill:opencode-plaud

## Forbidden
- [PLD-SF01] blocker · No full-file read.
  evidence: absent:get_file

- [PLD-SF02] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
