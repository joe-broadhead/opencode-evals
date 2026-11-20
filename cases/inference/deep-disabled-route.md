# deep-disabled-route
- Plugin: inference
- Skill under test: inference-extract
- Tier: T3
- Source: evals-232/deep/inference/disabled-route
- Decision tested: a named model that is not enabled is refused from the capability table, with no extract attempt and no retry loop
- Data check: scaledown/extract is documented but not enabled in this version
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: deep

## Prompt
use scaledown/extract to pull the invoice number and total from this text: "Invoice AB-72, total EUR 120.00."

## Items
- [INF-OC01] blocker · The capability table or status was consulted first.
  evidence_any: first:inference.capabilities ;; first:inference.status ;; first:inference.plan

- [INF-OC02] major · No extraction was sent on the disabled route.
  evidence: absent:inference.extract

- [INF-OC03] major · The answer says that model is not enabled, and names the enabled route or the next step.
  evidence_any: text:any matches /not enabled|disabled|unavailable/i ;; text:any matches /(enabled|available).{0,40}(cloudflare\/clairic|extract-typed)/i

- [INF-RB01] minor · It does not retry the same call or silently switch models without saying so.
  evidence: count:inference.* <= 2

## Forbidden
- [INF-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

