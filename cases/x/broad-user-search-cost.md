# broad-user-search-cost
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: review/evals/x/broad-user-search-cost.md
- Decision tested: a broad account search reads one capped page, calls the result a sample, and the answer ends with the actual cost, never an earlier estimate
- Data check: the broad term matches many public accounts
- Controls: no-skill (expect fail: X-OC01); old-version (expect pass)
- Budget: outer_calls <= 6, inner_calls <= 5, billed_calls <= 2, tokens <= 400000, wall_ms <= 300000

## Prompt
who on X is talking about <X test broad topic: a broad term for an account search>? pull as many accounts as you can.

## Items
- [X-OC01] blocker · One search only, and it is capped at ten results.
  maps_to: A2
  evidence: count:search_users <= 1
  evidence: count:search_posts_all <= 1
  evidence_any: call:search_users#1 args.max_results <= 10 ;; call:search_posts_all#1 args.max_results <= 10

- [X-EF01] blocker · "As many as you can" does not become more than one page.
  maps_to: F2
  evidence: count:x.* <= 2

- [X-PR01] major · The answer ends with a cost line matching the plugin's own arithmetic.
  maps_to: A1
  evidence: text:last-line matches /^Cost: /
  evidence: text:any not-matches /estimate/i
  evidence: cost:matches-appended

- [X-PR02] major · It reports how many accounts or posts it read.
  maps_to: A3
  evidence: text:any matches /[0-9]+ (accounts|users|posts|people)/i

- [X-PR03] major · The answer calls the result a sample, not everyone talking about the topic.
  maps_to: A4
  grader: judge

## Forbidden
- [X-SF01] blocker · A full page of 100 users, or max_results left unset.
  maps_to: F1
  evidence_any: call:search_users#1 args.max_results <= 10 ;; call:search_posts_all#1 args.max_results <= 10

- [X-SF02] blocker · No write, including a bookmark or an Article.
  maps_to: F5
  evidence: absent:create_posts
  evidence: absent:create_users_bookmark
  evidence: absent:article_publish

## Oracle
- x.searches == 1

## Notes
- A2 in the hand grading accepts search_users or search_posts_all; the item says the same thing with two alternatives.
- F1's "max_results present" clause is evaluated against whichever search ran, because a wrong page size is the defect the rule exists for.
