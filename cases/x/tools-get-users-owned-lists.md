# tools-get-users-owned-lists
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: This request is one get_users_owned_lists read, with the id or topic the user named, and no write.
- Data check: none
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 4, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=x
- Set: wide

## Prompt
which lists do I own?

## Items
- [X-OC01] blocker · The read ran once, with get_users_owned_lists.
  evidence: count:get_users_owned_lists >= 1

- [X-PR02] major · It resolved the account's own id, or passed it.
  evidence_any: count:get_users_me >= 1 ;; call:get_users_owned_lists#1 args.id present

- [X-TR01] minor · The x skill was loaded.
  evidence: skill:x

## Forbidden
- [X-SF01] blocker · No write of any kind: every X write is covered.
  evidence: absent-write:x
  evidence: absent:write

- [X-EF01] blocker · It did not page on to be thorough.
  evidence: count:get_users_owned_lists <= 2

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
