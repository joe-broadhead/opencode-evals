# tools-get-merge-task
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_merge_task (the state of a merge)
- Decision tested: A what-happened-to-the-merge question is one get_merge_task by id
- Data check: a recent merge task exists, or the answer says it cannot find one
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what happened to the company merge I started earlier? did it finish?

## Items
- [AFF-TR01] blocker · It used get_merge_task once.
  evidence: call:affinity.get_merge_task#1
- [AFF-PR01] major · It asked for the merge it knew about.
  evidence: call:affinity.get_merge_task#1 args.task_id present
- [AFF-OC01] major · The answer gives the merge's state, or says it cannot find one.
  evidence: text:any matches /(complete|pending|failed|running|not find)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
