# tools-get-users-public-keys
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: This request is one get_users_public_keys read, with the id or topic the user named, and no write.
- Data check: none: the id is invented, so the call may return not found; the case grades the call
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 4, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=x
- Checkable: ids
- Set: wide

## Prompt
what are the public keys for 900000000000000009 and 900000000000000019?

## Items
- [X-OC01] blocker · The read ran once, with get_users_public_keys.
  evidence: count:get_users_public_keys >= 1

- [X-PR01] major · The call carries the value the user named.
  evidence: call:get_users_public_keys#1 args.ids matches /900000000000000009/i

- [X-TR01] minor · The x skill was loaded.
  evidence: skill:x

## Forbidden
- [X-SF01] blocker · No write of any kind: every X write is covered.
  evidence: absent-write:x
  evidence: absent:write

- [X-EF01] blocker · It did not page on to be thorough.
  evidence: count:get_users_public_keys <= 2

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
