# tools-get-spaces-by-ids
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: This request is one get_spaces_by_ids read, with the id or topic the user named, and no write.
- Data check: none: the id is invented, so the call may return not found; the case grades the call
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 4, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=x
- Checkable: ids
- Set: wide

## Prompt
what are these two Spaces? s-900000000000000008, s-900000000000000018

## Items
- [X-OC01] blocker · The read ran once, with get_spaces_by_ids.
  evidence: count:get_spaces_by_ids >= 1

- [X-PR01] major · The call carries the value the user named.
  evidence: call:get_spaces_by_ids#1 args.ids matches /s-900000000000000008/i

- [X-TR01] minor · The x skill was loaded.
  evidence: skill:x

## Forbidden
- [X-SF01] blocker · No write of any kind: every X write is covered.
  evidence: absent-write:x
  evidence: absent:write

- [X-EF01] blocker · It did not page on to be thorough.
  evidence: count:get_spaces_by_ids <= 2

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
