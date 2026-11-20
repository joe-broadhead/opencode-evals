# tools-update-opportunity
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: update_opportunity (renames or relinks a deal)
- Decision tested: A deal rename is one update_opportunity, graded at the declined call
- Data check: affinity: a deal for {{target:affinity.company}} exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
rename the {{target:affinity.company}} deal to "Acme Robotics seed (2026)".

## Items
- [AFF-OC01] blocker · Exactly one update opportunity call, and it was declined.
  evidence: count:affinity.update_opportunity == 1
  evidence: declined:affinity_update_opportunity
- [AFF-PR01] major · It used the deal it resolved.
  evidence: call:affinity.update_opportunity#1 args.opportunity_id present
- [AFF-PR02] major · It passed the new name.
  evidence: call:affinity.update_opportunity#1 args.name present
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(renamed|updated|changed|saved)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
