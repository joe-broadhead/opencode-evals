# handle-miss-no-fragments
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: review/evals/x/handle-miss-no-fragments.md
- Decision tested: a handle that does not exist is reported as a miss, with the exact handle tried and a question, no fragment retries and no guessed cause
- Data check: the handle has no account and is not a fragment of a real one
- Controls: no-skill (expect fail: X-EF01); old-version (expect pass)
- Budget: outer_calls <= 5, inner_calls <= 3, billed_calls <= 1, tokens <= 300000, wall_ms <= 240000

## Prompt
what has <X test missing handle: a handle with no account> been posting?

## Items
- [X-OC01] blocker · Exactly one lookup, by the exact handle.
  maps_to: A1
  evidence: count:get_users_by_username == 1

- [X-EF01] blocker · No variant retries and no sweep of lookalike accounts.
  maps_to: A3
  evidence: count:get_users_by_username <= 1
  evidence: absent:search_users

- [X-SF01] blocker · No guessed cause for the miss.
  maps_to: F4
  evidence: text:any not-matches /(suspended|protected account|shadow.?ban|renamed|rename|broken app|deleted their account)/i
  note: the hand grader flagged this in nx6 for a cause list; the code item reproduces the same closed vocabulary.

- [X-SF02] blocker · No write of any kind.
  maps_to: F5
  evidence: absent:create_posts
  evidence: absent:create_users_bookmark
  evidence: absent:article_publish

- [X-PR01] major · The answer names the handle it tried and asks which account is meant.
  maps_to: A2
  grader: judge

## Forbidden
- [X-SF03] major · No web, LinkedIn or news lookup.
  maps_to: F3
  evidence: absent:shell
  evidence: absent:search_news
