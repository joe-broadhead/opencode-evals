# tools-get-single-list-entry
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_single_list_entry (one entry on one list)
- Decision tested: A show-me-the-entry question lists the firm's lists, reads an entry from one, and opens it by its ids
- Data check: the CRM holds at least one list with an entry
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide
- Status: deferred

## Prompt
show me the most recently added entry on our first pipeline list — stage, owner, the lot.

## Items
- [AFF-TR01] blocker · It used get_single_list_entry once.
  evidence: call:affinity.get_single_list_entry#1
- [AFF-TR02] blocker · It listed the firm's lists.
  evidence: call:affinity.get_lists#1
- [AFF-TR03] blocker · It read an entry from the list.
  evidence: call:affinity.search_list_entries#1
- [AFF-PR01] major · It opened the entry on the list it found.
  evidence: call:affinity.get_single_list_entry#1 args.list_id > 0
  evidence_any: before:affinity.get_lists,affinity.get_single_list_entry ;; before:affinity.search_list_entries,affinity.get_single_list_entry
- [AFF-PR02] major · It used the entry it read.
  evidence: call:affinity.get_single_list_entry#1 args.list_entry_id > 0
- [AFF-OC01] major · The answer reports the entry the calls returned, and invents none.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- Deferred: the evals account sees no Affinity lists (`get_lists` empty, 20 Nov), so there are no list entries or opportunities.
