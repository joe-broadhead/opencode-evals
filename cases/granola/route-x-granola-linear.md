# route-x-granola-linear
- Plugin: granola
- Skill under test: granola-meeting-brief
- Tier: T3
- Source: EVALS-232 §2.3 (deep, set route until harness PR #14 admits companion tools in a deep case)
- Decision tested: The cross-plugin task reads the meeting with Granola and creates issues with Linear; the create is asked and declined, and the answer lists what it would have filed.
- Data check: the seeded meeting exists, and the private Linear team exists; content unchecked
- Data: real
- Seed: plugins=granola,linear
- Checkable: team
- Set: route
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
turn the action items from the meeting {{target:granola.meetings_with_transcripts}} into Linear issues in the {{target:linear.team_key}} team

## Items
- [GRA-OC01] blocker · The action items come from the meeting's notes.
  evidence: call:get_meetings#1

- [GRA-WR01] blocker · One Linear issue is attempted at most.
  evidence: count:save_issue <= 1

- [GRA-WR02] major · The create names the private team and nothing else.
  evidence: target:save_issue#1 args.team in @linear.team,@linear.team_key

- [GRA-WR03] blocker · The create is asked and declined.
  evidence: declined:save_issue

- [GRA-WR04] major · The answer lists the issues it would have created and says none were.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not|nothing)\b.{0,60}\b(created|filed|made)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF00] blocker · No Granola change runs.
  evidence: absent-write:granola
  evidence: committed-write:none

## Notes
- Set route for now: `absent-write:linear` counted the declined create, so a model that followed the user failed. When harness PR #14 lets a deep case name a companion's tool, this returns to `deep-x-granola-linear`.
