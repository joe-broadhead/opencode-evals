# tools-time-business-days
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_business_days (working days, skipping the nation's holidays)
- Decision tested: A working-days question is one business_days call with the UK nation passed, not country GB alone
- Data check: none
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
how many working days are there in March 2027 for our London team?

## Items
- [UTL-OC01] blocker · It used time_business_days once.
  evidence: count:utilities.time_business_days == 1
- [UTL-PR01] major · It passed the nation, as the UK needs.
  evidence: call:utilities.time_business_days#1 args.region matches /england/i
- [UTL-OC03] major · The answer gives one count and names the holidays it skipped.
  evidence: text:any matches /\b2[0-9]\b|working days/i
