# tools-get-suggested-field-updates
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: get_suggested_field_updates (one suggested-update set with all its suggestions)
- Decision tested: A show-me-the-set question is one read by set id
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me suggested field update set sfu_000000000000000000000000 and what it suggests.

## Items
- [AFF-TR01] blocker · It used get_suggested_field_updates once.
  evidence: call:affinity.get_suggested_field_updates#1
- [AFF-PR01] major · It read the set the user named.
  evidence: call:affinity.get_suggested_field_updates#1 args.suggested_field_update_id == "sfu_000000000000000000000000"
- [AFF-OC01] major · The answer lists the suggestions.
  evidence: text:any matches /(suggest|field|update|set)/i
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
