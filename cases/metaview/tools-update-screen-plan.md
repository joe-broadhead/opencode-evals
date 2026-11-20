# tools-update-screen-plan
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: update_screen_plan (live once candidates are invited; re-scores interviews)
- Decision tested: A plan change is one call, graded at the declined call, with the whole plan passed
- Data check: the data engineer screen exists
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
add a system design section to the data engineer screen, after the coding one.

## Items
- [MV-WR01] blocker · Exactly one update screen plan call, and it was declined.
  evidence: count:metaview.update_screen_plan == 1
  evidence: declined:metaview_update_screen_plan
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.update_screen_plan#1 args.rationale present
- [MV-PR02] major · It used the screen it resolved.
  evidence: call:metaview.update_screen_plan#1 args.screen_id present
- [MV-PR03] major · It passed the whole plan with the new section.
  evidence: call:metaview.update_screen_plan#1 args.sections present
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(changed|updated|saved|added)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC02] major · The answer says the plan would apply to candidates already invited.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
