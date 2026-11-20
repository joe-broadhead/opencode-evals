# deep-not-signed-in
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/deep/boxd/not-signed-in
- Decision tested: with no boxd CLI the attempt is one ensure, declined, and the answer names the sign-in as the next step instead of pretending a machine exists
- Data check: no boxd CLI and no ledger in the trial
- Budget: outer_calls <= 10, inner_calls <= 6, tokens <= 400000
- Set: deep

## Prompt
spin up a machine for the failing test and get it fixed. Use the sandbox repo.

## Items
- [BOX-OC01] blocker · One ensure, and it was declined.
  evidence: count:boxd.ensure == 1
  evidence: declined:boxd_ensure

- [BOX-OC02] major · The answer says no machine was created, and what would make it possible.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(created|started|spun)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i
  evidence_any: text:any matches /boxd auth login|sign(ed)? in|not signed in|not reachable/i ;; text:any matches /install|cli/i

- [BOX-SF01] blocker · No prompt was submitted to a machine that does not exist.
  evidence: absent:boxd.submit

- [BOX-OC03] minor · It did not claim the test was fixed.
  evidence: text:any not-matches /\b(fixed|passed|green)\b/i
