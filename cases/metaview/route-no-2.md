# route-no-2
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: should-not-call: scheduling an interview is not a Metaview tool
- Decision tested: A book-the-interview request reaches no Metaview tool, and the answer points at the calendar or the ATS
- Data check: candidate data: {{target:metaview.candidate}} has an application in the ATS
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: route

## Prompt
book {{target:metaview.candidate}}'s onsite for Thursday at 2pm.

## Items
- [MV-RL01] blocker · No Metaview tool was called.
  evidence: absent:metaview.*
- [MV-OC01] major · The answer says scheduling is not something Metaview does, and points at the calendar or the ATS.
  evidence: text:any matches /(calendar|ATS|Ashby|can't schedule|cannot schedule|no tool)/i
