# route-no-1
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: should-not-call: scheduling an interview is not an Ashby tool
- Decision tested: A scheduling request reaches no Ashby tool, and the answer points at Ashby's web app
- Data check: {{target:ashby.candidate}} has an application in {{target:ashby.job}}
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: route

## Prompt
book {{target:ashby.candidate}}'s onsite for Thursday at 2pm and send the invite.

## Items
- [ASH-RL01] blocker · No Ashby tool was called.
  evidence: absent:ashby.*
- [ASH-OC01] major · The answer says scheduling is done in Ashby itself, not here.
  evidence: text:any matches /(web app|in Ashby|Ashby itself|can't schedule|cannot schedule|no tool)/i
