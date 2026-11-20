# tools-get-interactions-for-entity
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: get_interactions_for_entity (calls, chats or emails with one record)
- Decision tested: A calls-with-this-company question is one interactions read for the record and type
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the calls with company 424242 in October.

## Items
- [AFF-TR01] blocker · It used get_interactions_for_entity once.
  evidence: call:affinity.get_interactions_for_entity#1
- [AFF-PR01] major · It read the company the user named.
  evidence: call:affinity.get_interactions_for_entity#1 args.entity_id == 424242
- [AFF-OC01] major · It asked for the call type.
  evidence: call:affinity.get_interactions_for_entity#1 args.interaction_type matches /call/i
- [AFF-OC02] major · The answer lists the calls and names the company.
  evidence: text:any matches /(call|company|October|2026-)/i
- [AFF-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

- [AFF-OC08] major · It says the object was not found, and invents nothing.
  evidence: text:any matches /(not found|couldn't find|could not find|no such|doesn't exist|does not exist|404|no (interviewer|interview|company|path|opportunity|set|task|dictionary|guide))/i

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
