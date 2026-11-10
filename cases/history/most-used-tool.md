# most-used-tool
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: tool_call docs: read 186, edit 147, bash 131
- Decision tested: An aggregate over v_docs by tool.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
across all my sessions, which tool does the agent call the most?

## Items
- [H-OC01] blocker · It names read as the most used.
  evidence: text:any matches /\bread\b/i

- [H-OC02] major · It gives the count 186 (the number of read tool calls).
  evidence: text:any matches /\b186\b/i

- [H-PR01] major · It used sql.
  evidence: count:sql >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:apply_patch
