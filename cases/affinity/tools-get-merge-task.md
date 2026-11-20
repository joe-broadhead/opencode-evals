# tools-get-merge-task
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_merge_task (the state of a merge)
- Decision tested: A what-happened-to-the-merge question is one get_merge_task by id
- Data check: affinity: a recent merge task exists, or the answer says it cannot find one
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what happened to the company merge I started earlier? did it finish?

## Items
- [AFF-OC01] blocker · It used get_merge_task once.
  evidence: count:affinity.get_merge_task == 1
- [AFF-PR01] major · It asked for the merge it knew about.
  evidence: call:affinity.get_merge_task#1 args.task_id present
- [AFF-OC03] major · The answer gives the merge's state, or says it cannot find one.
  evidence: text:any matches /(complete|pending|failed|running|not find)/i
