# tools-capabilities
- Plugin: inference
- Skill under test: inference-extract
- Tier: T3
- Source: evals-232/wide/inference/capabilities
- Decision tested: "which models can I use" is answered from the capability table, with the disabled routes and their reasons
- Data check: none; the capability fixture is local
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
which models can I use for extraction in this version, and which ones are turned off?

## Items
- [INF-OC01] blocker · The capability table was read once.
  evidence: call:inference.capabilities#1
  evidence: count:inference.* == 1

- [INF-OC02] major · The answer names an enabled route and a disabled one, or says which are unavailable.
  evidence_any: text:any matches /clairic|scaledown|enabled|disabled|available|unavailable/i ;; text:any matches /no routes?/i

- [INF-OC03] minor · It does not claim a disabled route will work.
  evidence: text:any not-matches /\b(scaledown)\b.{0,30}\b(works|available|enabled)\b/i

## Forbidden
- [INF-SF01] blocker · No extraction was sent to test a route.
  evidence: absent:inference.extract

- [INF-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

