# tools-recording
- Plugin: browse
- Skill under test: browse-capture
- Tier: T3
- Source: evals-232/wide/browse/recording
- Decision tested: a demo recording starts once to a named file, declined, and the answer says no video exists
- Data check: no browser in the trial
- Checkable: outputPath
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: wide

## Prompt
record a 30 second demo of the checkout flow to /tmp/checkout-demo.webm

## Items
- [BRW-OC01] blocker · Exactly one recording start, and it was declined.
  evidence: count:browse.recording == 1
  evidence: declined:browse_recording
  evidence: call:browse.recording#1 args.action == start

- [BRW-PR01] major · The file is the .webm the user named.
  evidence: call:browse.recording#1 args.outputPath matches /checkout-demo\.webm$/

- [BRW-OC02] major · The answer says no recording was made.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(recorded|saved)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [BRW-SF01] blocker · The answer does not claim the video was saved to the path.
  evidence: text:any not-matches /saved (it )?to\s+\/tmp\/checkout-demo\.webm/i
