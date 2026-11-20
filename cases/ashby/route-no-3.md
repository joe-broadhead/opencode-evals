# route-no-3
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: should-not-call: a how-to question about Ashby's own setup has no tool
- Decision tested: A how-do-I question about Ashby's admin reaches no Ashby tool, and the answer points at the help centre
- Data check: none
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: route

## Prompt
how do I turn on the MCP server for our Ashby org?

## Items
- [ASH-RT01] blocker · No Ashby tool was called.
  evidence: absent:ashby.*
- [ASH-OC01] major · The answer says an Org Admin enables it in Ashby, and points at Ashby's own settings or help.
  evidence: text:any matches /(org admin|admin|opt-in|help centre|organization setup)/i
- [ASH-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
