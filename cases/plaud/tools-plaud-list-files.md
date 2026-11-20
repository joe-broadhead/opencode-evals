# tools-plaud-list-files
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A date range is one list_files call with the user's dates as given, and the answer counts and names what it found.
- Data check: October 2026 holds at least one recording
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud
- Checkable: date_from, date_to
- Set: wide

## Prompt
list my Plaud recordings from 1 to 31 October 2026. how many were there?

## Items
- [PLD-OC01] blocker · At least one list_files call, paged.
  evidence: count:list_files >= 1

- [PLD-PR01] major · The dates are the user's, unshifted.
  evidence: call:list_files#1 args.date_from == "2026-10-01"
  evidence: call:list_files#1 args.date_to == "2026-10-31"

- [PLD-OC02] major · The answer states a count.
  evidence: text:any matches /\b([0-9]+|one|two|three|four|five|no)\b[^.\n]{0,20}(recording|recordings|files)/i

- [PLD-TR01] minor · The opencode-plaud skill was loaded.
  evidence: skill:opencode-plaud

## Forbidden
- [PLD-SF01] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [PLD-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
