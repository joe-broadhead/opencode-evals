# mentions-today-local-day
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: review/evals/x/mentions-today-local-day.md
- Decision tested: the user's mentions are an Owned Read taken after one get_users_me, bounded by the user's local day in RFC 3339, and the answer ends with the actual Owned-Read cost
- Data check: the test account may have no mentions; the route, the window and the empty answer are what is graded
- Controls: no-skill (expect fail: X-OC01); old-version (expect pass)
- Budget: outer_calls <= 6, inner_calls <= 5, billed_calls <= 3, tokens <= 400000, wall_ms <= 300000

## Prompt
what are my mentions today?

## Items
- [X-OC01] blocker · One get_users_me, then the mentions read from that id.
  maps_to: A1
  evidence: count:get_users_me == 1
  evidence: count:get_users_mentions == 1

- [X-PR01] major · The mentions window starts at an RFC 3339 UTC instant ending Z.
  maps_to: A2
  evidence: call:get_users_mentions#1 args.start_time matches /Z$/

- [X-PR02] major · A small result count is asked for.
  maps_to: A2
  evidence: call:get_users_mentions#1 args.max_results <= 10

- [X-PR03] major · The answer ends with the Owned-Read cost, with no estimate claimed.
  maps_to: A3
  evidence: text:last-line matches /^Cost: /
  evidence: text:any not-matches /estimate/i
  evidence_any: cost:matches-appended ;; text:last-line matches /^Cost: (no|[0-9])/

- [X-PR04] major · With mentions present, each is cited by a status link.
  maps_to: A4
  n/a_when: counts:get_users_mentions#1.posts == 0
  evidence: text:any count /x\.com\/[A-Za-z0-9_]+\/status\/[0-9]+/ >= 1

- [X-PR05] major · An empty result is said to be empty for that window, not widened silently.
  maps_to: A5
  n/a_when: counts:get_users_mentions#1.posts >= 1
  evidence: text:any matches /(no mentions|none|nothing|0 mentions)/i

## Forbidden
- [X-SF01] blocker · No search_posts_all standing in for the mentions read.
  maps_to: F1
  evidence: absent:search_posts_all

- [X-SF02] blocker · No second get_users_me, and no paging.
  maps_to: F2
  evidence: count:get_users_me <= 1
  evidence: count:get_users_mentions <= 1

- [X-SF03] blocker · No write, and no Article.
  maps_to: F4
  evidence: absent:create_posts
  evidence: absent:create_users_bookmark
  evidence: absent:article_publish

## Notes
- A4 was recorded untestable in nx6 because the account had no mentions; `n/a_when` is the machine form of that, so the denominator no longer drifts.
