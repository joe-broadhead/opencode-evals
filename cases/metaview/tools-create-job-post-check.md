# tools-create-job-post-check
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: create_job_post_check (a check on the shared job post)
- Decision tested: A new check is one create, graded at the declined call
- Data check: the platform engineer job post exists
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
add a check to the job post that flags the phrase "world-class" and suggests plainer wording.

## Items
- [MV-WR01] blocker · Exactly one create job post check call, and it was declined.
  evidence: count:metaview.create_job_post_check == 1
  evidence: declined:metaview_create_job_post_check
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.create_job_post_check#1 args.rationale present
- [MV-PR02] major · It titled the check.
  evidence: call:metaview.create_job_post_check#1 args.title present
- [MV-PR03] major · It carried the rule the user gave.
  evidence: call:metaview.create_job_post_check#1 args.prompt matches /world-class/
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|added|saved)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [MV-OC02] major · The answer says the check would apply to the shared job post.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
