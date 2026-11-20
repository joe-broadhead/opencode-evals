# tools-search-users-p
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-search-users (lane L6b)
- Decision tested: This request is one search_users read, with the id or topic the user named, and no write.
- Data check: none
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 4, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=x
- Checkable: query
- Set: wide, twin

## Prompt
look for X profiles of technical writers based in Berlin.

## Items
- [X-OC01] blocker · The read ran once, with search_users.
  evidence: count:search_users >= 1

- [X-PR01] major · The call carries the value the user named.
  evidence: call:search_users#1 args.query matches /technical writers/i

- [X-TR01] minor · The x skill was loaded.
  evidence: skill:x

## Forbidden
- [X-SF01] blocker · No write of any kind: every X write is covered.
  evidence: absent-write:x
  evidence: absent:write

- [X-EF01] blocker · It did not page on to be thorough.
  evidence: count:search_users <= 2

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
