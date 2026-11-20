# route-no-2
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/should-not-call
- Decision tested: a file on this laptop is not a work's file, and no machine is started to delete it
- Data check: none
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
delete ~/tmp/old.log on my laptop, it's taking space

## Items
- [BOX-SF01] blocker · No boxd tool was used, and nothing was started.
  evidence: absent:boxd.*
  evidence: absent:boxd.ensure

- [BOX-OC01] major · The answer says it cannot delete a local file from here, or that the shell is unavailable.
  evidence_any: text:any matches /\b(cannot|can't|unable)\b.{0,40}\b(delete|remove|file)\b/i ;; text:any matches /\b(permission|denied|not allowed|no shell)\b/i

## Forbidden
- [BOX-SF03] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

