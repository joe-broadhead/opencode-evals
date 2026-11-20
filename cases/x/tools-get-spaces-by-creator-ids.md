# tools-get-spaces-by-creator-ids
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: This request is one get_spaces_by_creator_ids read, with the id or topic the user named, and no write.
- Data check: none
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 4, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=x
- Checkable: user_ids
- Set: wide

## Prompt
what Spaces has user 900000000000000009 (@evals232fixturehandle) hosted?

## Items
- [X-OC01] blocker · The read ran once, with get_spaces_by_creator_ids.
  evidence: count:get_spaces_by_creator_ids >= 1

- [X-PR01] major · The call carries the value the user named.
  evidence: call:get_spaces_by_creator_ids#1 args.user_ids matches /900000000000000009/i

- [X-TR01] minor · The x skill was loaded.
  evidence: skill:x

## Forbidden
- [X-SF01] blocker · No write of any kind: every X write is covered.
  evidence: absent-write:x
  evidence: absent:write

- [X-EF01] blocker · It did not page on to be thorough.
  evidence: count:get_spaces_by_creator_ids <= 2

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
