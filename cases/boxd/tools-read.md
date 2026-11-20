# tools-read
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/read
- Decision tested: one file is read from a work's tree without a harvest, and an unreachable boxd is reported plainly
- Data check: no boxd CLI in the trial
- Checkable: workId, path
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
read SUMMARY.md from the evals-232-demo work. don't harvest it, I just want to see the file.

## Items
- [BOX-OC01] blocker · The file was read once, from that work.
  evidence: call:boxd.read#1 args.workId == evals-232-demo
  evidence: call:boxd.read#1 args.path matches /SUMMARY\.md$/

- [BOX-OC02] major · The answer says the read failed or boxd is unreachable, and does not reproduce a file.
  evidence_any: text:any matches /not signed in|not reachable|not available|cannot reach|failed/i ;; text:any matches /(sign|log) in|boxd auth login/i

## Forbidden
- [BOX-SF01] blocker · No harvest was used to read one file.
  evidence: absent:boxd.harvest
