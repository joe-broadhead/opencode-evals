# tools-get-batch
- Plugin: openrouter
- Skill under test: openrouter-troubleshoot
- Tier: T3
- Source: evals-232/wide/openrouter/get-batch
- Decision tested: one batch is read by id, and its state is reported
- Data check: the id is the user's own batch
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
check batch batch_abc123 and tell me where it is up to

## Items
- [OR-OC01] blocker · The batch was read once, first.
  evidence: first:openrouter.get-batch
  evidence: count:openrouter.get-batch == 1

- [OR-OC02] major · The answer gives a state or says the batch is not found.
  evidence_any: text:any matches /validating|in_progress|completed|failed|cancelled/i ;; text:any matches /not found|no such/i

- [OR-OC03] minor · It does not start another batch to check this one.
  evidence: absent:openrouter.send-batch

## Forbidden
- [OR-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

