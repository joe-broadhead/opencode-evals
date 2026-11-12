# tools-brief-children
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needles audit-parent + three audit subagents
- Decision tested: history_brief with children: one call summarises a session and each of its subagent sessions.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 300000

## Prompt
brief the session where I asked for a quick audit of the auth, billing and catalog modules, and include what each of its subagent sessions did

## Items
- [H-OC01] blocker · It mentions all three audit areas: auth, billing and catalog.
  evidence: text:any matches /auth/i
  evidence: text:any matches /billing/i
  evidence: text:any matches /catalog/i

- [H-OC02] major · It used brief with children: true (one call), or briefed the subagents one by one.
  evidence_any: call:history.brief#1 args.children == true ;; count:history.brief >= 4

- [H-PR01] major · Cited in the full form (ses_… #seq), or by session ID.
  evidence: text:any matches /ses_mU7wCnfSqD3PT3fn6t7PjG/

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:apply_patch
