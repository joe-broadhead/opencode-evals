# tools-endpoint-uptime
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/get-endpoint-uptime-history
- Decision tested: a reliability question reads the uptime history for one model and a bounded window, once
- Data check: the window is within the last 72 hours
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
was any provider degraded on deepseek-chat yesterday afternoon, between 12:00 and 18:00 UTC?

## Items
- [OR-OC01] blocker · The uptime history was read once, first.
  evidence: first:openrouter.get-endpoint-uptime-history
  evidence: count:openrouter.get-endpoint-uptime-history == 1

- [OR-DT01] major · The answer reports a degradation or says there was none in that window.
  evidence_any: text:any matches /degrad|outage|error rate|uptime|no (incident|degradation)/i ;; text:any matches /no data|not available/i

- [OR-DT02] minor · It names the window it used.
  evidence: text:any matches /12:00|18:00|yesterday|UTC/i

## Forbidden
- [OR-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

