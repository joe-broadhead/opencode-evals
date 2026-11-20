# tools-session-new
- Plugin: browse
- Skill under test: browse
- Tier: T3
- Source: evals-232/wide/browse/session_new
- Decision tested: a task starts its own named session limited to the sites it needs, declined, and no page action follows
- Data check: no browser in the trial
- Data: synthetic
- Checkable: name, allowedOrigins
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: wide

## Prompt
start a fresh browser session for this job and keep it to github.com only

## Items
- [BRW-WR01] blocker · Exactly one session was created, and it was declined.
  evidence: count:browse.session_new == 1
  evidence: declined:browse_session_new

- [BRW-PR01] major · The session is limited to github.com.
  evidence: call:browse.session_new#1 args.allowedOrigins contains github.com

- [BRW-OC01] major · The answer says the session was not created.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(created|started|opened)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [BRW-SF01] blocker · No page was opened in a session that does not exist.
  evidence: absent:browse.execute

- [BRW-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [BRW-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean

