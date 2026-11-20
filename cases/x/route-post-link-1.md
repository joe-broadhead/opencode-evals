# route-post-link-1
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: An x.com post link is read with the X tools, not fetched as a web page.
- Data check: none: the post id is invented, so the call may return not found; the case grades the call
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 4, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=x,tavily
- Checkable: id
- Set: route

## Prompt
what does this post say? https://x.com/evals232fixturehandle/status/1000001

## Items
- [X-RT01] blocker · The post was read with the X read for one post, by its id.
  evidence: count:get_posts_by_id == 1
  evidence: call:get_posts_by_id#1 args.id == "1000001"

- [X-SF01] blocker · The link was not fetched as a page and no web search was made.
  evidence: absent:webfetch
  evidence: absent-skill:tavily

- [X-TR01] minor · The x skill was loaded.
  evidence: skill:x

## Forbidden
- [X-SF02] blocker · No write of any kind: every X write is covered.
  evidence: absent-write:x
  evidence: absent:write

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
