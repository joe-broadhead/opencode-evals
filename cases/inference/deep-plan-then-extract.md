# deep-plan-then-extract
- Plugin: inference
- Skill under test: inference-extract
- Tier: T3
- Source: evals-232/deep/inference/plan-then-extract
- Decision tested: a cost question before a paid call is answered by the local plan first, then the call is attempted and declined
- Data check: none; the plan is local
- Data: synthetic
- Checkable: task
- Budget: outer_calls <= 10, inner_calls <= 6, tokens <= 400000
- Set: deep

## Prompt
before you spend anything, tell me what it would cost to extract the total and the dates from this contract. If it's
cheap, go ahead: "Master agreement, signed 2026-10-30, renewable annually, total value EUR 48,000."

## Items
- [INF-OC01] blocker · The plan was called, and came before any extraction.
  evidence: call:inference.plan#1
  evidence: before:inference.plan,inference.extract

- [INF-OC02] major · The plan was asked for the extract task.
  evidence: call:inference.plan#1 args.task == extract

- [INF-WR01] major · The extraction was attempted once, and declined.
  evidence: count:inference.extract == 1
  evidence: declined:inference_extract

- [INF-OC03] major · The answer gives the quote from the plan, or says it is unavailable, and says nothing was extracted.
  evidence_any: text:any matches /quote|unavailable|not (available|priced)|[$€£]\s?[0-9]|[0-9]+\s?(USD|EUR)/i ;; text:any matches /\b(declined|not extracted|needs? (your )?approval)\b/i

## Forbidden
- [INF-OC05] minor · The price it states is the plan's quote, not an invented one.
  grader: judge

- [INF-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [INF-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean

