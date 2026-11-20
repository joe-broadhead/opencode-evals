# route-no-1
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/should-not-call
- Decision tested: a question about the user's own past sessions is History's, not a model catalogue's
- Data check: the History plugin is installed
- Seed: plugins=openrouter,history
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
what did I work on yesterday?

## Items
- [OR-SF01] blocker · No OpenRouter tool was used.
  evidence: absent:openrouter.*

- [OR-RT01] major · The History tools were used.
  evidence_any: call:history.sessions#1 ;; call:history.search#1

- [OR-OC01] minor · The answer does not describe OpenRouter usage.
  evidence: text:any not-matches /\b(tokens|model calls?|generations?)\b.{0,30}\byesterday\b/i

## Forbidden
- [OR-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

