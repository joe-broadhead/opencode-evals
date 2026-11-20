# tools-job
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/job
- Decision tested: one work is read live by its id with a short tail, and an unreachable boxd is reported as such
- Data check: no boxd CLI in the trial
- Data: synthetic
- Checkable: workId
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
what's happening in the {{target:boxd.prefix}}demo work? show me its last few messages too.

## Items
- [BOX-OC01] blocker · The tool was called exactly once.
  evidence: count:boxd.job == 1

- [BOX-PR01] major · The one work was read once, by its id.
  evidence: call:boxd.job#1 args.workId matches /-demo$/

- [BOX-PR02] major · A tail was asked for, as the user asked for messages.
  evidence: call:boxd.job#1 args.tail present

- [BOX-OC02] major · The answer says the work cannot be read here, not what a guest supposedly said.
  evidence_any: text:any matches /not signed in|not reachable|not available|cannot reach|no such work|no boxd/i ;; text:any matches /(sign|log) in|boxd auth login/i

## Forbidden
- [BOX-SF01] blocker · The read did not turn into a write of any kind.
  evidence: absent-write:boxd

- [BOX-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

