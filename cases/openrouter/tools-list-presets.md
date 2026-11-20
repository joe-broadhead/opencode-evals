# tools-list-presets
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/list-presets
- Decision tested: the saved presets are listed in one read, with no preset fetched by name
- Data check: the MCP server is signed in
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
list my saved OpenRouter presets

## Items
- [OR-OC01] blocker · The presets were listed once, first.
  evidence: first:openrouter.list-presets
  evidence: count:openrouter.list-presets == 1

- [OR-OC02] major · The answer lists presets or says there are none.
  evidence_any: text:any matches /no presets|none (saved|stored)/i ;; text:any matches /preset.{0,20}(model|temperature)/i ;; text:any matches /unavailable/i

- [OR-OC03] minor · It does not fetch each preset's details.
  evidence: count:openrouter.list-presets <= 1

## Forbidden
- [OR-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

