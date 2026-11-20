# tools-plaud-events-list
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A cursor feed of what changed is one events_list call, oldest first, for the consumer that asked.
- Data check: the account has recordings after the cursor
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud
- Set: wide

## Prompt
pull everything that changed in my Plaud account since <the cursor the last sync returned>, oldest first, for the Memory feed.

## Items
- [PLD-OC01] blocker · Exactly one events_list call.
  evidence: count:events_list == 1

- [PLD-PR01] major · The cursor the user gave was passed.
  evidence: call:events_list#1 args.cursor present

- [PLD-OC02] major · The answer reports the events in order, or says there are none.
  evidence_any: text:any matches /(no (new )?events|nothing new|none)/i ;; text:any matches /(first|oldest|1\.)/i

- [PLD-TR01] minor · The opencode-plaud skill was loaded.
  evidence: skill:opencode-plaud

## Forbidden
- [PLD-SF01] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [PLD-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
