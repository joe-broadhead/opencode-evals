# route-no-2
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: should-not-call: scheduling an interview is not a Metaview tool
- Decision tested: A book-the-interview request reaches no Metaview tool, and the answer points at the calendar or the ATS
- Data check: the most recent candidate has an application in the ATS
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: route

## Prompt
book the most recent candidate's onsite for Thursday at 2pm.

## Items
- [MV-RT01] blocker · No Metaview tool was called.
  evidence: absent:metaview.*
- [MV-OC01] major · The answer says scheduling is not something Metaview does, and points at the calendar or the ATS.
  evidence: text:any matches /(calendar|\bATS\b|Ashby|can't schedule|cannot schedule|no tool)/i
- [MV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
