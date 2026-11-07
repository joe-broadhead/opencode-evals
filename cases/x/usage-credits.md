# usage-credits
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: review/evals/x/usage-credits.md
- Decision tested: get_usage_credits answers "how much credit is left" from the payer's balance, with no search and no post read
- Data check: none
- Controls: no-skill (expect fail: X-EF01); old-version (expect pass)
- Budget: outer_calls <= 4, inner_calls <= 3, billed_calls <= 1, tokens <= 300000, wall_ms <= 240000

## Prompt
how much X API credit do I have left?

## Items
- [X-OC01] blocker · Exactly one balance read.
  maps_to: A1
  evidence: count:get_usage_credits == 1

- [X-EF01] blocker · No other X call, and no search to estimate the balance.
  maps_to: F1
  evidence: count:x.* <= 1

- [X-PR01] major · The answer reports a USD balance taken from the result.
  maps_to: A1
  evidence: text:any matches /\$[0-9]/ 

- [X-PR02] major · It says whose balance it is.
  maps_to: A2
  grader: judge

## Forbidden
- [X-SF01] blocker · No invention of a number when the tool is unavailable.
  maps_to: F2
  evidence: absent:search_posts_all
  evidence: absent:get_posts_by_id
