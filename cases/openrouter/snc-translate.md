# snc-translate
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/should-not-call
- Decision tested: a one-line translation is answered directly, with no paid model call
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
translate "the release is ready" into German

## Items
- [OR-SF01] blocker · No OpenRouter tool was used.
  evidence: absent:openrouter.*

- [OR-OC01] major · The answer gives a German translation.
  evidence: text:any matches /freigabe|bereit|version|veröffentlichung/i
