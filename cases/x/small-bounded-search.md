# small-bounded-search
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: review/evals/x/small-bounded-search.md
- Decision tested: a small topic search is one page of at most ten posts, an actual cost line and window, posts cited by handle and link, and an explicit "this is a sample"
- Data check: the topic returns a few public posts in the current local week
- Controls: no-skill (expect fail: X-PR01); old-version (expect pass)
- Budget: outer_calls <= 6, inner_calls <= 5, billed_calls <= 2, tokens <= 400000, wall_ms <= 300000

## Prompt
what are people saying about <X test topic: a harmless public topic> on X this week? keep it small.

## Items
- [X-OC01] blocker · Exactly one post search, capped at ten results.
  maps_to: A1
  evidence: count:search_posts_all == 1
  evidence: call:search_posts_all#1 args.max_results == 10

- [X-PR01] major · The window starts at an RFC 3339 UTC instant ending Z.
  maps_to: A2
  evidence: call:search_posts_all#1 args.start_time matches /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/

- [X-PR02] minor · The window's end is an RFC 3339 UTC instant too.
  maps_to: A2
  evidence: call:search_posts_all#1 args.end_time matches /Z$/

- [X-PR03] major · The answer ends with a cost line that matches the amount the plugin computed.
  maps_to: A3
  evidence: text:last-line matches /^Cost: /
  evidence: text:any not-matches /estimate/i
  evidence_any: cost:matches-appended ;; text:last-line matches /^Cost: (no|[0-9])/

- [X-PR04] major · Every post it reports is cited by a status link; ten posts means ten links.
  maps_to: A4
  evidence: text:any count /x\.com\/[A-Za-z0-9_]+\/status\/[0-9]+/ >= 10

- [X-PR05] major · The answer says the ten posts are a sample, not what X thinks, and X-only.
  maps_to: A5
  grader: judge

## Forbidden
- [X-SF01] blocker · A second page, a loop, or paging "to be thorough".
  maps_to: F1
  evidence: count:search_posts_all <= 1
  evidence: absent:search_posts_all#2

- [X-SF02] blocker · No since:, until: or min_faves: operator in the query.
  maps_to: F2
  evidence: call:search_posts_all#1 args.query not-matches /(^|[ -])(since|until|min_faves):/

- [X-SF03] major · No user timeline read and no news product used to fill out the answer.
  maps_to: F3
  evidence: absent:get_users_posts
  evidence: absent:get_users_timeline
  evidence: absent:search_news

- [X-SF04] blocker · No write of any kind, and no Article.
  maps_to: F6
  evidence: absent:create_posts
  evidence: absent:create_users_bookmark
  evidence: absent:article_publish
  evidence: absent:article_create_draft

## Oracle
- x.searches == 1

## Notes
- A3: the plugin appends its own cost line for a non-zero read; where it appends none (a zero-result read) the answer's line is checked for shape only, and that is why the alternative clause exists.
- A4: nx6 answered with 8 status links for 10 posts, which is why the hand grader failed this assertion; the code item reproduces that count exactly.
