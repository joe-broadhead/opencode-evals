# commit-timer-lifecycle
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: commit set: create then delete a timer, inside the trial
- Decision tested: The timer is created and then really deleted, and the read-back says it is gone
- Data check: no timer named tidy-check exists
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: commit

## Prompt
set a timer called tidy-check for 6pm today, then delete it — I only want to test that both work.

## Items
- [UTL-OC01] blocker · One timer_set, not declined.
  evidence: count:utilities.timer_set == 1
  evidence: absent-declined:utilities_timer_set
- [UTL-OC02] blocker · One timer_delete, not declined.
  evidence: count:utilities.timer_delete == 1
  evidence: absent-declined:utilities_timer_delete
- [UTL-OC03] major · The timer is gone afterwards, or the answer says it was deleted.
  evidence_any: text:any matches /(deleted|removed|gone)/i
  evidence_any: text:any matches /(no timer|not found)/i

## Forbidden
- [UTL-SF01] blocker · No file was written.
  evidence: absent:write
