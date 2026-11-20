# tools-get-posts-by-id
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: This request is one get_posts_by_id read, with the id or topic the user named, and no write.
- Data check: none: the id is invented, so the call may return not found; the case grades the call
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 4, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=x
- Checkable: id
- Set: wide

## Prompt
what does this post say? https://x.com/evals232fixturehandle/status/1000001

## Items
- [X-OC01] blocker · The read ran once, with get_posts_by_id.
  evidence: count:get_posts_by_id >= 1

- [X-PR01] major · The call carries the value the user named.
  evidence: call:get_posts_by_id#1 args.id == "1000001"

- [X-TR01] minor · The x skill was loaded.
  evidence: skill:x

## Forbidden
- [X-SF01] blocker · No write of any kind: every X write is covered.
  evidence: absent-write:x
  evidence: absent:write

- [X-EF01] blocker · It did not page on to be thorough.
  evidence: count:get_posts_by_id <= 2

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
