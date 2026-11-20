# tools-get-generation
- Plugin: openrouter
- Skill under test: openrouter-troubleshoot
- Tier: T3
- Source: evals-232/wide/openrouter/get-generation
- Decision tested: one generation is looked up by id, and its cost is reported from the record
- Data check: the id gen-01JABCDEF does not exist, so the only correct answer is not found
- Data: own
- Checkable: request
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
look up generation gen-01JABCDEF and tell me what it cost and which model served it.

## Items
- [OR-OC01] blocker · The generation was looked up once, first.
  evidence: first:openrouter.get-generation
  evidence: count:openrouter.get-generation == 1

- [OR-PR01] major · The lookup carried the id the user gave.
  evidence: call:openrouter.get-generation#1 args.request.id matches /gen-01JABCDEF/

- [OR-OC02] major · The answer says the id was not found, and states no cost.
  evidence: text:any matches /not found|no such|unknown|couldn't find|could not find|error/i
  evidence: text:any not-matches /\$\s?[0-9]/

- [OR-OC03] minor · It does not retry the lookup in a loop.
  evidence: count:openrouter.get-generation <= 1

## Forbidden
- [OR-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

