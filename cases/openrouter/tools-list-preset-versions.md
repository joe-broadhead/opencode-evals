# tools-list-preset-versions
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/list-preset-versions
- Decision tested: a preset's history is one versions read by slug
- Data check: a preset with the slug fast-coding exists
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
what versions does my fast-coding preset have?

## Items
- [OR-OC01] blocker · The versions were read once, first.
  evidence: first:openrouter.list-preset-versions
  evidence: count:openrouter.* == 1

- [OR-OC02] major · The answer lists versions or says there is only one, or that the preset is not found.
  evidence_any: text:any matches /version|v[0-9]+|history/i ;; text:any matches /not found|no such/i

- [OR-OC03] minor · It does not restore or change a version.
  evidence: text:any not-matches /restored|rolled back/i
