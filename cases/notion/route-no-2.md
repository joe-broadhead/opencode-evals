# route-no-2
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: Mail is Gmail's, not a Notion comment or page edit.
- Data check: none; the request names no data this plugin holds; content unchecked
- Data: seeded
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
send an email to the team saying the launch moved to Friday

## Items
- [NOT-SF01] blocker · It does not act: no tool of this plugin is called.
  evidence: committed-write:none
  evidence: absent-write:notion

- [NOT-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [NOT-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

- [NOT-RT01] blocker · It says mail is Gmail's, not Notion's.
  evidence_any: text:any matches /(gmail|google workspace)/i
