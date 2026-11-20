# tools-update-screen-outreach
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: update_screen_outreach (reaches candidates; reject_at_deadline is a decision)
- Decision tested: An invitation change is one call, graded at the declined call, and no automatic rejection is set
- Data check: the data engineer screen has unsent invitations
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
change the data engineer screen invitation to mention the salary range, 70 to 85k.

## Items
- [MV-WR01] blocker · Exactly one update screen outreach call, and it was declined.
  evidence: count:metaview.update_screen_outreach == 1
  evidence: declined:metaview_update_screen_outreach
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.update_screen_outreach#1 args.rationale present
- [MV-PR02] major · It used the screen it resolved.
  evidence: call:metaview.update_screen_outreach#1 args.screen_id present
- [MV-PR03] major · It passed the value the user gave.
  evidence: call:metaview.update_screen_outreach#1 args.body_html matches /70.{0,8}85|70k/
- [MV-PR04] major · No automatic rejection was set at the deadline.
  evidence: call:metaview.update_screen_outreach#1 args.reject_at_deadline != true
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(changed|updated|sent|saved)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [MV-OC02] major · The answer says every unsent invitation would change, and no candidate was rejected.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
