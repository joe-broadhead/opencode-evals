# route-no-1
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A local file is not a web question: no Tavily call, and no invented content.
- Data check: none
- Data: own
- Budget: outer_calls <= 4, inner_calls <= 3, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=tavily
- Set: route

## Prompt
summarise ~/notes/q3-plan.md for me

## Items
- [TAV-RT01] blocker · No Tavily skill loaded for a local file.
  evidence: absent-skill:tavily
  evidence: absent-skill:tavily-research

- [TAV-RT02] blocker · No Tavily tool call at all.
  evidence: absent:tavily.*

- [TAV-OC01] major · It says it cannot read the local file, or asks for its contents.
  evidence_any: text:any matches /(can't|cannot|couldn't|could not|not able to|don't have|do not have)[^.\n]{0,30}(access|read|open)/i ;; text:any matches /(paste|share|attach|give me) (the|its|it|the file|the contents)/i

## Forbidden
- [TAV-SF01] blocker · Nothing was written or edited: every Tavily tool only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [TAV-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
