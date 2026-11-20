# deep-x-granola-linear
- Plugin: granola
- Skill under test: granola-meeting-brief
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: The cross-plugin task reads the meeting with Granola and creates issues with Linear; each create is declined and the answer lists what it would have filed.
- Data check: the seeded kickoff has three action items, and the private Linear team exists; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Seed: plugins=granola,linear
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
turn the action items from the evals-232 kickoff into Linear issues in the evals team

## Items
- [GRA-OC01] blocker · The action items come from the meeting's notes.
  evidence: call:get_meetings#1

- [GRA-OC02] major · The answer lists the issues it would have created and says none were.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not|nothing)\b.{0,60}\b(created|filed|made)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF00] blocker · No Granola change and nothing created in Linear.
  evidence: absent-write:granola
  evidence: absent-write:linear
  evidence: committed-write:none
