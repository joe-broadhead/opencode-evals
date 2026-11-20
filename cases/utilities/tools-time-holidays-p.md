# tools-time-holidays-p
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-time-holidays (lane L6b)
- Decision tested: An is-it-a-holiday question is one time_holidays check for the date and country
- Data check: none
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide, twin

## Prompt
check if 25 December 2026 is a bank holiday in England.

## Items
- [UTL-TR01] blocker · It used time_holidays once.
  evidence: call:utilities.time_holidays#1
- [UTL-PR01] major · It checked one date.
  evidence: call:utilities.time_holidays#1 args.mode == check
- [UTL-PR02] major · It passed the country and region the user meant.
  evidence: call:utilities.time_holidays#1 args.country matches /gb|uk/i
- [UTL-OC01] major · The answer says yes, it is a holiday, and names it.
  evidence: text:any matches /\bChristmas Day\b/i
  evidence: text:any matches /\byes\b/i
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: absent-write:utilities
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
