# tools-list-suggested-field-updates-tasks
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: list_suggested_field_updates_tasks (the user's SFU generation tasks)
- Decision tested: A list-my-tasks question is one list
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
list my suggested field update tasks.

## Items
- [AFF-TR01] blocker · It used list_suggested_field_updates_tasks once.
  evidence: call:affinity.list_suggested_field_updates_tasks#1
- [AFF-OC01] major · The answer lists the tasks the tool returned, or says there are none.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
