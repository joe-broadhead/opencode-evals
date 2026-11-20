# tools-endpoint-uptime
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/get-endpoint-uptime-history
- Decision tested: a reliability question reads the uptime history for one model and a bounded window, once
- Data check: the window is within the last 72 hours
- Data: own
- Seed: utc-hours=9-17
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
was any provider degraded on deepseek-chat yesterday afternoon, between 12:00 and 18:00 UTC?

## Items
- [OR-OC01] blocker · The uptime history was read, and a model lookup may come first.
  evidence: call:openrouter.get-endpoint-uptime-history#1
  evidence_any: first:openrouter.get-endpoint-uptime-history ;; first:openrouter.list-model-endpoints
  evidence: count:openrouter.get-endpoint-uptime-history <= 3

- [OR-PR01] major · The read carried a bounded window, as ISO instants.
  evidence: call:openrouter.get-endpoint-uptime-history#1 args.from matches /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/
  evidence: call:openrouter.get-endpoint-uptime-history#1 args.to matches /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/

- [OR-DT01] major · The answer reports a degradation with a figure, or says there was none.
  evidence_any: text:any matches /[0-9]+(\.[0-9]+)?\s?%|no (incident|degradation|outage)/i ;; text:any matches /no data|not available/i

- [OR-DT02] minor · It names the window with a date or a time.
  evidence: text:any matches /[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}:[0-9]{2}/

## Forbidden
- [OR-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

