# deep-provider-choice
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/deep/openrouter/provider-choice
- Decision tested: a provider choice for one model is grounded in its endpoints and their uptime, and the answer separates what it measured from what it assumed
- Data check: deepseek-chat has at least two endpoints
- Data: own
- Budget: outer_calls <= 10, inner_calls <= 6, tokens <= 400000
- Set: deep

## Prompt
which provider should I pin for deepseek-chat if I care about EU data handling and steady uptime? Give me one
recommendation.

## Items
- [OR-OC01] blocker · The endpoints were read first.
  evidence: first:openrouter.list-model-endpoints

- [OR-OC02] major · The provider list was read at most once.
  evidence: count:openrouter.list-providers <= 1
  evidence: count:openrouter.list-model-endpoints <= 1

- [OR-OC03] major · The answer names providers and one recommendation.
  evidence: text:any matches /recommend|pin|prefer/i
  evidence: text:any matches /[A-Z][A-Za-z0-9.-]{2,}/

- [OR-OC04] major · It states what it could not verify, such as regional handling.
  evidence: text:any matches /cannot (verify|confirm)|not (stated|documented|shown)|assum/i

## Forbidden
- [OR-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

