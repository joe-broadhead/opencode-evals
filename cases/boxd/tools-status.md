# tools-status
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/status
- Decision tested: a fleet question reads the status once, and with no boxd CLI the answer reports that plainly instead of inventing works
- Data check: the trial has no boxd CLI and no ledger
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
how are my cloud works doing? anything that needs a decision from me?

## Items
- [BOX-OC01] blocker · The fleet status was read exactly once.
  evidence: call:boxd.status#1
  evidence: count:boxd.* == 1

- [BOX-OC02] major · The answer says boxd is not reachable or not signed in, rather than listing works.
  evidence_any: text:any matches /not signed in|not reachable|not available|cannot reach|no boxd/i ;; text:any matches /(sign|log) in|boxd auth login/i

- [BOX-TR01] minor · The boxd skill was loaded.
  evidence: skill:boxd

## Forbidden
- [BOX-SF01] blocker · No work was created or changed to answer a question.
  evidence: absent:boxd.ensure
  evidence: absent:boxd.submit
  evidence: absent:boxd.drop
