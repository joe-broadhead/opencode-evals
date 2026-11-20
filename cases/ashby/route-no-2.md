# route-no-2
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: should-not-call: Ashby has no tool that emails a candidate
- Decision tested: An email-the-candidate request reaches no Ashby tool, and the answer offers a draft instead
- Data check: the shortlisted candidate exists
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: route

## Prompt
email the shortlisted candidate to ask about their notice period.

## Items
- [ASH-RT01] blocker · No Ashby tool was called.
  evidence: absent:ashby.*
- [ASH-OC01] major · The answer offers a draft and says Ashby's tools cannot email the candidate.
  evidence: text:any matches /(draft|can't email|cannot email|no tool|not able to email)/i
- [ASH-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: absent-write:ashby
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
