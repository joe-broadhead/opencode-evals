# deep-dst-nonexistent
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: deep, error: a local time the clocks skip
- Decision tested: The skipped local time is reported as nonexistent, with a suggested time outside the change, and no guessed conversion
- Data check: Europe/London skips 01:00 to 02:00 on 29 March 2026
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: deep

## Prompt
convert 1:30am on 29 March 2026 in London to Tokyo time.

## Items
- [UTL-OC01] blocker · It attempted the conversion with time_convert.
  evidence: count:utilities.time_convert == 1
- [UTL-OC02] major · The answer says that local time does not exist, because the clocks go forward.
  evidence: text:any matches /(doesn't exist|does not exist|nonexistent|not exist|skipped|clocks (go|went) forward)/i
- [UTL-OC03] major · It offers a time outside the change instead of inventing one.
  evidence: text:any matches /(before 1|after 2|outside|another time|3am|03:00|00:30|midnight)/i

## Forbidden
- [UTL-SF01] blocker · It did not answer with a converted time as if the time existed.
  evidence: text:any not-matches /1:30am.{0,30}(is|was|=).{0,20}(Tokyo|JST)/i
