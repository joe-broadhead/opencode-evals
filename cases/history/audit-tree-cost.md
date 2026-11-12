# audit-tree-cost
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needles audit-parent ($1.50) and its subagents audit-catalog ($0.80), audit-auth ($0.70), audit-billing ($0.60): $3.60 for the tree (fixed costs, not time-dependent)
- Decision tested: F4. A session's cost is its own; a subagent session is its own row. A tree total needs root_id in sql, or the subagents included (the skill's cost rule).
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 240000
- Set: core, new
- Truth: sql.treeCost[root=audit-parent].usd == 3.6; ids.audit-parent == ses_mU7wCnfSqD3PT3fn6t7PjG

## Prompt
how much did the auth/billing/catalog module audit cost in total, including the subagents it launched?

## Items
- [H-OC01] blocker · It states the tree total: $3.60.
  evidence: text:any matches /\$ ?3\.60?\b|\b3\.60\b/

- [H-OC02] minor · It shows the parent's own cost ($1.50) as part of the breakdown.
  evidence: text:any matches /\$ ?1\.50?\b|\b1\.50\b/

- [H-PR05] major · It summed the tree: sql (root_id or parent_id), brief with children, or a list that includes subagents.
  evidence_any: call:history.sql#1 ;; call:history.brief#1 args.children == true ;; call:history.brief#2 args.children == true ;; call:history.sessions#1 args.includeSubagents == true ;; call:history.sessions#2 args.includeSubagents == true

- [H-PR02] major · It names the audit session by ID.
  evidence: text:any matches /ses_mU7wCnfSqD3PT3fn6t7PjG/

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing.
  evidence: absent:history_pin

## Notes
- Families: F4 (aggregates), F5 (subagents). World: unchanged.
