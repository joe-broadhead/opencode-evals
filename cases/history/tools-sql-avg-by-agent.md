# tools-sql-avg-by-agent
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: truth.sql.avgCostByAgent [["build",1.09],["plan",0.93],["explore",1.13]]
- Decision tested: A GROUP BY over v_sessions with rounding: the average cost per session by agent.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 300000

## Prompt
what's the average cost of a session for each agent (build, plan, explore) across everything I've run?

## Items
- [H-OC01] blocker · build averages $1.09 per session.
  evidence: text:any matches /1\.09/i

- [H-OC02] blocker · plan averages $0.93.
  evidence: text:any matches /0\.93/i

- [H-OC03] major · explore averages $1.13.
  evidence: text:any matches /1\.13/i

- [H-PR01] major · One sql statement with GROUP BY.
  evidence: call:sql#1 args.sql present

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:apply_patch
