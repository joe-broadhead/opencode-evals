# tools-consider-candidate-for-job
- Plugin: ashby
- Skill under test: ashby-write
- Tier: T3
- Source: wide sweep: consider_candidate_for_job (Ashby MCP; adds a candidate to a job's pipeline)
- Decision tested: Adding to a pipeline is one call, graded at the declined call, and the answer warns that the first stage may email
- Data check: the shortlisted candidate has no application for {{target:ashby.job}}
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
add the shortlisted candidate to {{target:ashby.job}} so the hiring team sees them.

## Items
- [ASH-WR01] blocker · Exactly one consider candidate for job call, and it was declined.
  evidence: count:ashby.consider_candidate_for_job == 1
  evidence: declined:ashby_consider_candidate_for_job
- [ASH-PR01] major · It addressed the candidate the user named.
  evidence: call:ashby.consider_candidate_for_job#1 args.candidateId present
- [ASH-PR02] major · Aimed at the sandbox target the user named, and nothing else.
  evidence: target:ashby.consider_candidate_for_job#1 args.jobId in @ashby.job
- [ASH-OC01] major · The answer says nothing was added, and that the hiring team and possibly the candidate would have been reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(saved|added|moved|sent|created|changed|archived|deleted|submitted)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [ASH-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing was committed and no other change was made.
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
