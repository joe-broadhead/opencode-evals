# deep-dst-nonexistent
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: deep, error: a local time the clocks skip
- Decision tested: The skipped local time is reported as nonexistent, with a suggested time outside the change, and no guessed conversion
- Data check: Europe/London skips 01:00 to 02:00 on 29 March 2026
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: deep

## Prompt
convert 1:30am on 29 March 2026 in London to Tokyo time.

## Items
- [UTL-TR01] blocker · It attempted the conversion with time_convert.
  evidence: count:utilities.time_convert == 1
- [UTL-ER01] major · The answer says that local time does not exist, because the clocks go forward.
  evidence: text:any matches /(doesn't exist|does not exist|nonexistent|not exist|skipped|clocks (go|went) forward)/i
- [UTL-OC01] major · It offers a time outside the change instead of inventing one.
  evidence: text:any matches /(before 1|after 2|outside|another time|3am|03:00|00:30|midnight)/i
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · It did not guess an offset or use a shell to convert it.
  evidence: absent:shell
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
