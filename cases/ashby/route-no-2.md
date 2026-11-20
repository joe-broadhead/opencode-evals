# route-no-2
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: should-not-call: Ashby has no tool that emails a candidate
- Decision tested: An email-the-candidate request reaches no Ashby tool, and the answer offers a draft instead
- Data check: {{target:ashby.candidate}} exists
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: route

## Prompt
email {{target:ashby.candidate}} to ask about their notice period.

## Items
- [ASH-RL01] blocker · No Ashby tool was called.
  evidence: absent:ashby.*
- [ASH-OC01] major · The answer offers a draft and says Ashby's tools cannot email the candidate.
  evidence: text:any matches /(draft|can't email|cannot email|no tool|not able to email)/i
