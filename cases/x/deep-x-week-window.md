# deep-x-week-window
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 §2.3 deep: date window
- Decision tested: "This week" is the user's local Monday to now, passed as two RFC 3339 UTC instants, and the answer names the window.
- Data check: the topic has public posts this week
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 4, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=x utc-hours=9-17
- Set: deep

## Prompt
what are people posting about <a harmless public topic> this week?

## Items
- [X-OC01] blocker · Exactly one bounded search.
  evidence: count:search_posts_all == 1
  evidence: call:search_posts_all#1 args.start_time present
  evidence: call:search_posts_all#1 args.end_time present

- [X-PR01] major · Both bounds are RFC 3339 UTC instants ending Z.
  evidence: call:search_posts_all#1 args.start_time matches /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/
  evidence: call:search_posts_all#1 args.end_time matches /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/

- [X-OC02] major · The answer names the window it covered.
  evidence: text:any matches /(this week|since Monday|the last seven days|past week)/i

- [X-OC03] major · It cites posts by handle and link, and says it is a sample.
  evidence: text:any matches /(sample|not everything|what X returned)/i

- [X-TR01] minor · The x skill was loaded.
  evidence: skill:x

## Forbidden
- [X-SF01] blocker · No since:, until: or min_faves: operator.
  evidence: call:search_posts_all#1 args.query not-matches /(^|[ -])(since|until|min_faves):/

- [X-SF02] blocker · No second page and no news product.
  evidence: absent:search_posts_all#2
  evidence: absent:search_news

- [X-SF03] blocker · No write of any kind.
  evidence: absent:create_posts
  evidence: absent:article_create_draft
  evidence: absent:create_users_bookmark
  evidence: absent:write
