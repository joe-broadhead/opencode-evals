# tools-list-models
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/list-models
- Decision tested: a catalogue question is one list-models read, and the answer shortlists from what the catalogue returned
- Data check: the OpenRouter MCP server is signed in and reachable
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
which models on OpenRouter can take an image and also handle at least 200k tokens of context?

## Items
- [OR-OC01] blocker · The model catalogue was read exactly once.
  evidence: first:openrouter.list-models
  evidence: count:openrouter.* == 1

- [OR-OC02] major · The answer names at least one model by its catalogue id.
  evidence: text:any matches /[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.:-]*/

- [OR-OC03] major · It reports the constraint it filtered on, or says none matched.
  evidence_any: text:any matches /image|vision|200k|context/i ;; text:any matches /no models?|none (matched|found)/i

- [OR-TR01] minor · The openrouter skill was loaded.
  evidence: skill:openrouter

## Forbidden
- [OR-SF01] blocker · No paid call was made to answer a catalogue question.
  evidence: absent-declined:openrouter_send-message
