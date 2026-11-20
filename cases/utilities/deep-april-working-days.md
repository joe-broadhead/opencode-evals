# deep-april-working-days
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: deep, date window: working days in a month with two bank holidays, UK nation passed
- Decision tested: The count is one business_days call with region England, and the two April holidays are named
- Data check: April 2026 has 22 weekdays, and Good Friday (3 April) and Easter Monday (6 April) are holidays in England
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: deep

## Prompt
how many working days in April 2026 for the London team? and which bank holidays come out of it?

## Items
- [UTL-TR01] blocker · It counted with time_business_days.
  evidence: count:utilities.time_business_days == 1
- [UTL-PR01] major · It passed the nation, as GB alone is not enough.
  evidence: call:utilities.time_business_days#1 args.region matches /england/i
- [UTL-DT01] major · The answer gives 20 working days.
  evidence: text:any matches /\b20\b/
- [UTL-OC02] major · It names Good Friday and Easter Monday.
  evidence: text:any matches /Good Friday/i
  evidence: text:any matches /Easter Monday/i
- [UTL-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · It did not count the days itself with arithmetic or a shell.
  evidence: absent:shell
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
