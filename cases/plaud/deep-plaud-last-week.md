# deep-plaud-last-week
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 §2.3 deep: date window
- Decision tested: "Last week" is a bounded local window, stated in the answer, with each recording's day named.
- Data check: last week holds at least two recordings
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud utc-hours=9-17
- Set: deep

## Prompt
what did I record last week? give me the days and lengths.

## Items
- [PLD-DT01] blocker · The read was bounded to last week.
  evidence_any: call:list_files#1 args.date_from present ;; call:recent#1

- [PLD-DT02] major · The answer names the window it covered.
  evidence: text:any matches /(last week|week of|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i

- [PLD-OC01] major · Each recording is named with its day and length.
  evidence: text:any matches /([0-9]+ ?(min|minutes|h|hours)|[0-9]{1,2}:[0-9]{2})/i

- [PLD-TR01] minor · The opencode-plaud skill was loaded.
  evidence: skill:opencode-plaud

## Forbidden
- [PLD-EF01] blocker · No transcript or full-file read for a list.
  evidence: absent:get_transcript
  evidence: absent:get_file

- [PLD-SF02] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [PLD-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
