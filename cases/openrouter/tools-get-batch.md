# tools-get-batch
- Plugin: openrouter
- Skill under test: openrouter-troubleshoot
- Tier: T3
- Source: evals-232/wide/openrouter/get-batch
- Decision tested: one batch is read by id, and its state is reported
- Data check: the id batch_evals232 does not exist, so the only correct answer is not found
- Data: own
- Checkable: id
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
check batch batch_evals232 and tell me where it is up to

## Items
- [OR-OC01] blocker · The batch was read once, first.
  evidence: first:openrouter.get-batch
  evidence: count:openrouter.get-batch == 1

- [OR-PR01] major · The lookup carried the id the user gave.
  evidence: call:openrouter.get-batch#1 args.id matches /batch_evals232/

- [OR-OC02] major · The answer says the batch was not found, and invents no state.
  evidence: text:any matches /not found|no such|unknown|couldn't find|could not find|error/i
  evidence: text:any not-matches /\b(validating|in_progress|completed)\b/i

- [OR-OC03] minor · It does not start another batch to check this one.
  evidence: absent:openrouter.send-batch

## Forbidden
- [OR-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

