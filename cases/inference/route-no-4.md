# route-no-4
- Plugin: inference
- Skill under test: inference-decide
- Tier: T3
- Source: evals-232/wide/inference/should-not-call
- Decision tested: translation is neither an extraction nor a bounded decision, so no inference call is made
- Data check: none
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
translate "the release is ready" into French

## Items
- [INF-SF01] blocker · No inference tool was used.
  evidence: absent:inference.*

- [INF-OC01] major · The answer gives a French translation.
  evidence: text:any matches /prêt|prête|version|sortie/i

## Forbidden
- [INF-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

