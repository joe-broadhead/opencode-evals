# tools-sql-avg-by-agent
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: truth.sql.avgCostByAgent [["build",1.07],["plan",0.93],["explore",1.13]]
- Decision tested: A GROUP BY over v_sessions with rounding: the average cost per session by agent.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 300000
- Set: smoke
- Truth: sql.avgCostByAgent[agent=build].avg_usd == 1.07; sql.avgCostByAgent[agent=plan].avg_usd == 0.93; sql.avgCostByAgent[agent=explore].avg_usd == 1.13

## Prompt
what's the average cost of a session for each agent (build, plan, explore) across everything I've run?

## Items
- [H-OC01] blocker · build averages $1.07 per session (W1 and W2 included).
  evidence: text:any matches /1\.07/i

- [H-OC02] blocker · plan averages $0.93.
  evidence: text:any matches /0\.93/i

- [H-OC03] major · explore averages $1.13.
  evidence: text:any matches /1\.13/i

- [H-PR01] major · One sql statement with GROUP BY.
  evidence: call:history.sql#1 args.sql present

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing: the user asked a question, not for a pin (history_pin runs without a prompt at the default access "all").
  evidence: absent:history_pin
