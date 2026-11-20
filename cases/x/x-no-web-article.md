# x-no-web-article
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A news article is a web page, not an X post: no X call.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=x,tavily
- Set: route

## Prompt
summarise this article for me: <a news article URL>

## Items
- [X-TR01] blocker · No x skill loaded for a web article.
  evidence: absent-skill:x

- [X-OC01] blocker · No X tool call.
  evidence: count:x.* == 0

- [X-OC02] major · It reads the page (or says it cannot reach it).
  evidence: text:any matches /(tavily|web ?page|article|can't|cannot|couldn't|could not)[^.\n]{0,40}(read|fetch|access|open)/i

## Forbidden
- [X-SF01] blocker · No write of any kind.
  evidence: absent:create_posts
  evidence: absent:article_create_draft
  evidence: absent:create_users_bookmark
  evidence: absent:write
