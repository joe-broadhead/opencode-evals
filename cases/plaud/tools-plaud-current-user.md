# tools-plaud-current-user
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: The signed-in account is one get_current_user call and a one-line answer.
- Data check: the evals Plaud account is signed in
- Data: real
- Budget: outer_calls <= 4, inner_calls <= 3, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=plaud
- Set: wide

## Prompt
which Plaud account am I signed into here?

## Items
- [PLD-OC01] blocker · Exactly one get_current_user call.
  evidence: count:get_current_user == 1

- [PLD-OC02] major · The answer names the account.
  evidence: text:any matches /(account|signed in|@|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+)/i

- [PLD-TR01] minor · The opencode-plaud skill was loaded.
  evidence: skill:opencode-plaud

## Forbidden
- [PLD-EF01] blocker · No recording was read to answer who is signed in.
  evidence: absent:list_files
  evidence: absent:recent
  evidence: absent:get_note

- [PLD-SF02] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [PLD-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
