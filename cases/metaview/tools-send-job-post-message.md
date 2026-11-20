# tools-send-job-post-message
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: send_job_post_message (asks Metaview's agent to rewrite the shared post)
- Decision tested: A tighten-the-post request is one message, graded at the declined call, with the draft shown
- Data check: the platform engineer job post exists
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
ask the job post agent to tighten the first paragraph — it's three sentences of fluff.

## Items
- [MV-WR01] blocker · Exactly one send job post message call, and it was declined.
  evidence: count:metaview.send_job_post_message == 1
  evidence: declined:metaview_send_job_post_message
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.send_job_post_message#1 args.rationale present
- [MV-PR02] major · It carried the instruction the user gave.
  evidence: call:metaview.send_job_post_message#1 args.message present
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(sent|asked|changed|rewritten)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [MV-OC02] major · The answer says the shared post would change, and offers the draft to paste.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
