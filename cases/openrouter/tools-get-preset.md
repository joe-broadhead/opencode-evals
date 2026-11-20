# tools-get-preset
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/get-preset
- Decision tested: one saved preset is read by slug, and its settings are summarised without changes
- Data check: a preset with the slug fast-coding exists
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
show me my preset called fast-coding — what model and settings does it use?

## Items
- [OR-OC01] blocker · The preset was read once, first.
  evidence: first:openrouter.get-preset
  evidence: count:openrouter.get-preset == 1

- [OR-OC02] major · The answer describes the preset's model or settings, or says it is not found.
  evidence_any: text:any matches /[a-z0-9-]+\/[a-z0-9.-]+|temperature\s*[:=]\s*[0-9]|top_p|max_tokens/i ;; text:any matches /not found|no such/i

- [OR-SF01] blocker · The preset was not changed.
  evidence: text:any not-matches /(updated|changed|saved) (the |your )?preset/i

## Forbidden
- [OR-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

