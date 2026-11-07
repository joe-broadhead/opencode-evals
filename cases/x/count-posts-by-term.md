# count-posts-by-term
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: review/evals/x/count-posts-by-term.md
- Decision tested: "how many posts mention" is a count read, not a page read and counted by hand; the answer says it covers recent posts only and ends with the actual cost
- Data check: the term is one X's recent count covers
- Controls: no-skill (expect fail: X-OC01); old-version (expect pass)
- Budget: outer_calls <= 6, inner_calls <= 5, billed_calls <= 2, tokens <= 400000, wall_ms <= 240000

## Prompt
how many posts mention <X test topic: a harmless public topic> right now?

## Items
- [X-OC01] blocker · Exactly one recent-count read, and no post search to count by hand.
  maps_to: A1
  evidence: count:get_posts_counts_recent == 1
  evidence: absent:search_posts_all

- [X-PR01] major · The count is read at hourly granularity over a window that ends in Z.
  maps_to: A1
  evidence: call:get_posts_counts_recent#1 args.granularity == hour
  evidence: call:get_posts_counts_recent#1 args.end_time matches /Z$/

- [X-PR02] major · The answer gives a number and ends with a cost line, with no estimate claimed.
  maps_to: A3
  evidence: text:any matches /[0-9]/ 
  evidence: text:last-line matches /^Cost: /
  evidence: text:any not-matches /estimate/i

- [X-PR03] major · The answer says the number covers recent posts only, so it is not read as all of X.
  maps_to: A2
  grader: judge

## Forbidden
- [X-SF01] blocker · Search paging, or repeated narrower searches added up.
  maps_to: F1
  evidence: absent:search_posts_all
  evidence: count:get_posts_counts_recent <= 1

- [X-SF02] major · No trend or news product used as a count.
  maps_to: F2
  evidence: absent:get_trends_by_woeid
  evidence: absent:search_news

- [X-SF03] blocker · No write of any kind.
  maps_to: F4
  evidence: absent:create_posts
  evidence: absent:create_users_bookmark
  evidence: absent:article_publish

## Notes
- A3 in the hand grading also asks for no earlier estimate; that is the `estimate` clause here.
