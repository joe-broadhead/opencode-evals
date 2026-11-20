# tools-get-suggested-field-updates-task
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: get_suggested_field_updates_task (whether an SFU generation task finished)
- Decision tested: A is-it-finished question is one task read by id
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
is suggested field update task task_000000000000000000000000 finished?

## Items
- [AFF-TR01] blocker · It used get_suggested_field_updates_task once.
  evidence: call:affinity.get_suggested_field_updates_task#1
- [AFF-PR01] major · It read the task the user named.
  evidence: call:affinity.get_suggested_field_updates_task#1 args.task_id == "task_000000000000000000000000"
- [AFF-OC01] major · The answer says whether the task finished.
  evidence: text:any matches /(finished|running|pending|complete|failed)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

- [AFF-OC08] major · It says the object was not found, and invents nothing.
  evidence: text:any matches /(not found|couldn't find|could not find|no such|doesn't exist|does not exist|404|no (interviewer|interview|company|path|opportunity|set|task|dictionary|guide))/i

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
