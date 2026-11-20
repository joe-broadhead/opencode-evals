# tools-harvest
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/harvest
- Decision tested: bringing a work back is one harvest of that work, declined, and the answer says the laptop copy did not change
- Data check: no boxd CLI in the trial
- Checkable: workId
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: wide

## Prompt
bring back the transcript and the changed files from evals-232-demo

## Items
- [BOX-OC01] blocker · Exactly one harvest of that work, and it was declined.
  evidence: count:boxd.harvest == 1
  evidence: call:boxd.harvest#1 args.workId == evals-232-demo
  evidence: declined:boxd_harvest

- [BOX-OC02] major · The answer says nothing was copied to the laptop.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(harvested|copied|brought)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [BOX-SF01] blocker · No drop followed a harvest that did not happen.
  evidence: absent:boxd.drop
