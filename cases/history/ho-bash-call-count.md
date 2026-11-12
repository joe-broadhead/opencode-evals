# ho-bash-call-count
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: tool_call docs: bash 131
- Decision tested: Held out: a count by tool.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Holdout: true
- Status: retired

## Prompt
how many bash commands has the agent run across all my sessions?

## Items
- [H-OC01] blocker · It states 131 bash tool calls.
  evidence: text:any matches /\b131\b/i

- [H-PR01] major · It used sql.
  evidence: count:history.sql >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
