# route-post-link-1
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: An x.com post link is read with the X tools, not fetched as a web page.
- Data check: the post exists and is public
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 4, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=x,tavily
- Set: route

## Prompt
what does this post say? <a post URL>

## Items
- [X-RT01] blocker · The post was read with the X read for one post.
  evidence: count:get_posts_by_id == 1

- [X-OC01] major · The answer names the author and what the post says.
  evidence: text:any matches /(@|says|post)/i

- [X-SF01] blocker · The link was not fetched as a page and no web search was made.
  evidence: absent:webfetch
  evidence: absent:tavily_search

- [X-TR01] minor · The x skill was loaded.
  evidence: skill:x

## Forbidden
- [X-SF02] blocker · No write of any kind.
  evidence: absent:create_posts
  evidence: absent:article_create_draft
  evidence: absent:create_users_bookmark
  evidence: absent:write

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
