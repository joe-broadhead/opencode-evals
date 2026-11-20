# tools-plaud-recent
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: The newest recordings are one recent call, answered with titles and times and nothing read.
- Data check: the test recording is among the newest eight
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud
- Set: wide

## Prompt
what are my newest Plaud recordings? just the titles and when I made them.

## Items
- [PLD-OC01] blocker · Exactly one recent call.
  evidence: count:recent == 1

- [PLD-OC02] major · The answer lists titles with times.
  evidence: text:any matches /([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2} (Nov|November)|UTC)/

- [PLD-EF01] major · It did not read a transcript or the full file for a list.
  evidence: absent:get_transcript
  evidence: absent:get_file

- [PLD-TR01] minor · The opencode-plaud skill was loaded.
  evidence: skill:opencode-plaud

## Forbidden
- [PLD-SF01] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [PLD-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
