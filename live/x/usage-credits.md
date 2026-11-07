<!-- live checklist, unrun: copied from the review set (x/usage-credits.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# usage-credits
- Skill under test: x
- Decision tested: `get_usage_credits` answers "how much credit is left?" from the payer's balance, with no search or post read
- Data check: none

## Prompt
how much X API credit do I have left?

## Assertions
- Calls `get_usage_credits` once, and reports the balance in USD from its result
- Says it is the X developer account that owns the app (the user's, or their team's)
- If the tool is unavailable or errors, says so and does not guess a number

## Forbidden
- A search, a post read or any other X call just to estimate the balance
- Guessing or inventing a number
- Claiming it bought credit or changed the spending limit
