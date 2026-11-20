# tools-create-ai-field
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: create_ai_field (a workspace AI field; a write, asked at ask-changes)
- Decision tested: A new AI field is one create, graded at the declined call, with the name, prompt and value type stated first
- Data check: the workspace's AI fields
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
add an AI field called "Led a team" that answers yes or no from the interview, with a one-line reason.

## Items
- [MV-WR01] blocker · Exactly one create ai field call, and it was declined.
  evidence: count:metaview.create_ai_field == 1
  evidence: declined:metaview_create_ai_field
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.create_ai_field#1 args.rationale present
- [MV-PR02] major · It passed the value the user gave.
  evidence: call:metaview.create_ai_field#1 args.name == "Led a team"
- [MV-PR03] major · It chose a boolean or single-line type.
  evidence: call:metaview.create_ai_field#1 args.value_type present
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|added|saved)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [MV-OC02] major · The answer states that a workspace-wide field was proposed, and shows the prompt it would use.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
