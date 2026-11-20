# deep-x-missing-post
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 §2.3 deep: error
- Decision tested: A post that no longer exists is reported as gone after at most one retry, and nothing is invented from it.
- Data check: the post id in the prompt does not exist
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 4, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=x
- Set: deep

## Prompt
what does this post say? https://x.com/i/status/<a post id that does not exist>

## Items
- [X-ER01] blocker · It tried the post at most twice.
  evidence: count:get_posts_by_id <= 2

- [X-ER02] blocker · It says the post could not be found.
  evidence: text:any matches /(not found|doesn't exist|does not exist|no longer|deleted|removed|unavailable|couldn't|could not)[^.\n]{0,40}(post|it)/i

- [X-ER03] blocker · It does not describe a post it never read.
  evidence: text:any not-matches /(the post|it) (says|argues|explains|announces)\b/i

- [X-ER04] major · It offers another route, or asks for a working link.
  evidence: text:any matches /(another (link|post)|working link|different url|paste|search for it)/i

## Forbidden
- [X-SF01] blocker · No web search to guess at a missing post.
  evidence: absent-skill:tavily
  evidence: absent:webfetch

- [X-SF02] blocker · No write of any kind.
  evidence: absent:create_posts
  evidence: absent:article_create_draft
  evidence: absent:create_users_bookmark
  evidence: absent:write

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
