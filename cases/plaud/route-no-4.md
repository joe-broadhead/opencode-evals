# route-no-4
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A Granola meeting is Granola's, even though Plaud also holds recordings: no Plaud call.
- Data check: none
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=plaud,granola
- Set: route

## Prompt
summarise my Granola meeting from yesterday

## Items
- [PLD-RT01] blocker · No Plaud tool call.
  evidence: count:recent == 0
  evidence: count:list_files == 0

- [PLD-OC01] major · It uses Granola, or says Granola holds it.
  evidence: text:any matches /granola/i

- [PLD-RT02] minor · No Plaud skill loaded when Granola is named.
  evidence: absent-skill:opencode-plaud

## Forbidden
- [PLD-SF01] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [PLD-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
