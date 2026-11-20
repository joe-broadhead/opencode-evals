# route-no-2
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A news article is a web page, not an X post: no X call.
- Data check: none
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=x,tavily
- Set: route

## Prompt
summarise this article for me: https://example.org/news/evals-232

## Items
- [X-RT01] blocker · No x skill loaded for a web article.
  evidence: absent-skill:x

- [X-RT02] blocker · No X tool call.
  evidence: absent:x.*

- [X-RT03] major · It read the page, or says it cannot reach it.
  evidence_any: count:tavily.* >= 1 ;; count:webfetch >= 1 ;; text:any matches /(can't|cannot|couldn't|could not)[^.\n]{0,30}(read|fetch|access|open)/i

## Forbidden
- [X-SF01] blocker · No write of any kind: every X write is covered.
  evidence: absent-write:x
  evidence: absent:write

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
