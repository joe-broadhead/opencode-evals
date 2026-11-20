# tools-plan
- Plugin: inference
- Skill under test: inference-extract
- Tier: T3
- Source: evals-232/wide/inference/plan
- Decision tested: a cost-and-support question is answered by the free local plan, which sends and charges nothing
- Data check: none; the plan is local
- Data: synthetic
- Checkable: task
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: wide

## Prompt
what would it cost to pull the invoice number and the total out of a long invoice text, and would the route even
accept it?

## Items
- [INF-OC01] blocker · The plan was asked for the extract task, exactly once.
  evidence: count:inference.plan == 1

- [INF-PR01] major · The plan is for the task the user asked for.
  evidence: call:inference.plan#1 args.task == extract

- [INF-OC02] major · The answer gives the route, the quote or the reason it cannot run.
  evidence_any: text:any matches /quote|cost|price|route|coverage/i ;; text:any matches /unavailable|refus|not supported/i

- [INF-SF01] blocker · The plan sent nothing and charged nothing.
  evidence: absent:inference.extract
  evidence: text:any matches /nothing was (read|sent|charged)|no charge|free|local/i

## Forbidden
- [INF-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

