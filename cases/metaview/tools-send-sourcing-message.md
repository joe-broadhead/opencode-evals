# tools-send-sourcing-message
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: send_sourcing_message (starts or refines a sourcing search; one per role)
- Decision tested: A start-a-search request is one send, graded at the declined call, with one brief for the role
- Data check: the workspace has sourcing enabled
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
start a sourcing search for backend engineers in Lisbon, one brief, five years plus.

## Items
- [MV-WR01] blocker · Exactly one send sourcing message call, and it was declined.
  evidence: count:metaview.send_sourcing_message == 1
  evidence: declined:metaview_send_sourcing_message
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.send_sourcing_message#1 args.rationale present
- [MV-PR02] major · It passed the value the user gave.
  evidence: call:metaview.send_sourcing_message#1 args.message matches /Lisbon|backend/
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(started|sent|created)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC02] major · The answer says a search would start and takes minutes, and nothing was sent.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
