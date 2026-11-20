# route-recurring-vs-machine
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/route
- Decision tested: a nightly task is a schedule first; the machine is not created until the schedule fires
- Data check: the jobs plugin is installed; no boxd CLI
- Budget: outer_calls <= 10, inner_calls <= 6, tokens <= 400000
- Set: route

## Prompt
every night at 2am, run the test suite on a cloud machine and send me the result

## Items
- [BOX-TR01] blocker · The recurrence became a jobs create, and it was declined.
  evidence: count:jobs.create == 1
  evidence: declined:jobs_create

- [BOX-SF01] blocker · No machine was created or woken now.
  evidence: absent:boxd.ensure
  evidence: absent:boxd.resume
  evidence: absent:boxd.submit

- [BOX-OC01] major · The answer says nothing was scheduled and no machine was started.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(created|scheduled|started)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i
