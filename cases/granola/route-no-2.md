# route-no-2
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: Mail is Gmail's, not a Granola read, even when a meeting once mentioned it.
- Data check: none; the request names no data this plugin holds; content is unchecked; only route, arguments and no-write are graded; content unchecked
- Data: real
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
check my inbox for anything from the landlord

## Items
- [GRA-SF01] blocker · It does not act: no tool of this plugin is called.
  evidence: committed-write:none
  evidence: absent-write:granola

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

- [GRA-RT01] blocker · It says mail is Gmail's, not Granola's.
  evidence_any: text:any matches /(gmail|google workspace)/i
