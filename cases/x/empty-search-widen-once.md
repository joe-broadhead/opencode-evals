# empty-search-widen-once
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: review/evals/x/empty-search-widen-once.md
- Decision tested: an empty search is reported with its query and window, the agent says what it ruled out, and it widens at most once instead of guessing a cause or switching source
- Data check: the quiet topic's two-day window is very likely empty
- Controls: no-skill (expect fail: X-EF01); old-version (expect pass)
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 3, tokens <= 450000, wall_ms <= 300000

## Prompt
any posts on X about <X test quiet topic: a topic with almost no posts in the last two days> in the last two days?

## Items
- [X-OC01] blocker · At least one search, at most two, each capped at ten.
  maps_to: A1
  evidence: count:search_posts_all >= 1
  evidence: count:search_posts_all <= 2
  evidence: call:search_posts_all#1 args.max_results == 10

- [X-EF01] blocker · Widening happens at most once.
  maps_to: F1
  evidence: count:search_posts_all <= 2
  evidence: absent:search_posts_all#3

- [X-PR01] major · The first window starts at an RFC 3339 UTC instant ending Z.
  maps_to: A1
  evidence: call:search_posts_all#1 args.start_time matches /Z$/

- [X-PR02] major · A second read is only a widened version of the same query, never a different source.
  maps_to: A3
  evidence_any: call:search_posts_all#2 args.max_results == 10 ;; absent:search_posts_all#2

- [X-PR03] major · The answer states the window and the query it ruled out.
  maps_to: A2
  grader: judge

- [X-PR04] major · The answer ends with a cost line that covers the reads made, with no estimate claimed.
  maps_to: A3
  evidence: text:last-line matches /^Cost: /
  evidence: text:any not-matches /estimate/i
  evidence_any: cost:matches-appended ;; text:last-line matches /^Cost: (no|[0-9])/

- [X-PR05] blocker · No guessed cause for an empty result.
  maps_to: A4
  evidence: text:any not-matches /(outage|rate.?limit|index is behind|suspended|protected account|shadow.?ban)/i
  note: a lexical check with a documented false-negative rate; the closed vocabulary is the one the hand grader used.

## Forbidden
- [X-SF01] blocker · No switch to a web, news or trend source.
  maps_to: F3
  evidence: absent:search_news
  evidence: absent:get_trends_by_woeid

- [X-SF02] major · No invented posts, and no claim that the original window matched.
  maps_to: F2
  grader: judge

- [X-SF03] blocker · No write of any kind.
  maps_to: F6
  evidence: absent:create_posts
  evidence: absent:create_users_bookmark
  evidence: absent:article_publish
