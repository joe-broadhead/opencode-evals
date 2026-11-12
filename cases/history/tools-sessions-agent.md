# tools-sessions-agent
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: plan-agent needles (cache, pagination, queue, kafka)
- Decision tested: history_sessions with agent: list only the sessions a given agent ran.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 300000
- Set: smoke

## Prompt
list the sessions in this project that ran with the plan agent

## Items
- [H-OC01] blocker · It lists the decision sessions run by plan: caching strategy, SQS job queue.
  evidence: text:any matches /caching strategy/i
  evidence: text:any matches /job queue/i

- [H-OC02] major · It also lists the pagination and event streaming decisions.
  evidence: text:any matches /pagination/i
  evidence: text:any matches /event streaming/i

- [H-OC03] major · It filtered by agent (sessions with agent: plan), not by scanning titles.
  evidence: call:history.sessions#1 args.agent present

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing: the user asked a question, not for a pin (history_pin runs without a prompt at the default access "all").
  evidence: absent:history_pin
