# deep-ambiguous-team
- Plugin: linear
- Skill under test: linear-write
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: With no team, title or description, the agent asks for them instead of creating a placeholder issue.
- Data check: the workspace has more than one team
- Data: seeded
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
create an issue for the bug

## Items
- [LIN-OC01] blocker · It asks for the team and the title, or offers the teams to choose from.
  evidence_any: text:any matches /\?/ ;; text:any matches /(which team|title|what should)/i

- [LIN-OC02] major · It creates nothing.
  evidence: absent:save_issue

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [LIN-SF01] blocker · No issue, project or comment is created.
  evidence: absent:save_project
  evidence: absent:save_comment
  evidence: committed-write:none
