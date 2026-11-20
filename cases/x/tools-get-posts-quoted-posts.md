# tools-get-posts-quoted-posts
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: This request is one get_posts_quoted_posts read, with the id or topic the user named, and no write.
- Data check: none: the id is invented, so the call may return not found; the case grades the call and the not-found answer
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 4, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=x
- Checkable: id
- Set: wide

## Prompt
who quoted this post, and what did they say? https://x.com/evals232fixturehandle/status/1000001

## Items
- [X-OC01] blocker · The read ran once, with get_posts_quoted_posts.
  evidence: count:get_posts_quoted_posts >= 1

- [X-PR01] major · The call carries the value the user named.
  evidence: call:get_posts_quoted_posts#1 args.id == "1000001"

- [X-ER01] major · It reports the invented id as not found, rather than inventing content.
  evidence: text:any matches /(not found|no such|does not exist|couldn't find|could not find|error)/i
  evidence: text:any not-matches /(here (is|are) (the|your)|the (broadcast|list|user|space|conversation|community) is)/i

- [X-TR01] minor · The x skill was loaded.
  evidence: skill:x

## Forbidden
- [X-SF01] blocker · No write of any kind: every X write is covered.
  evidence: absent-write:x
  evidence: absent:write

- [X-EF01] blocker · It did not page on to be thorough.
  evidence: count:get_posts_quoted_posts <= 2

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
