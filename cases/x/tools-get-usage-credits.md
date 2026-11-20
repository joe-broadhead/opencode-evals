# tools-get-usage-credits
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: This request is one get_usage_credits read, answered from its result, with no second page and no write.
- Data check: the ids and handles in the prompt exist for the evals X account
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 4, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=x
- Set: wide

## Prompt
how much X credit do I have left?

## Items
- [X-OC01] blocker · The read ran once, with get_usage_credits.
  evidence: count:get_usage_credits >= 1

- [X-OC02] major · The answer carries what the read returned.
  evidence: text:any matches /(\$|credit|balance)/i

- [X-TR01] minor · The x skill was loaded.
  evidence: skill:x

## Forbidden
- [X-SF01] blocker · No write of any kind.
  evidence: absent:create_posts
  evidence: absent:article_create_draft
  evidence: absent:create_users_bookmark
  evidence: absent:follow_list
  evidence: absent:write

- [X-SF02] blocker · It did not page on to be thorough.
  evidence: count:get_usage_credits <= 2

## Notes
- X's own tool descriptions are long; the skill's names and fields are exact, so a search() for this tool is a wasted step, not a failure.
