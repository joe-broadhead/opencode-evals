# route-no-2
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A question about this project's own code is not answered from the web, and nothing is invented about the code.
- Data check: none
- Data: real
- Budget: outer_calls <= 4, inner_calls <= 3, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=tavily
- Set: route

## Prompt
how does the retry wrapper in src/http.ts decide when to back off?

## Items
- [TAV-RT01] blocker · No Tavily skill loaded for the project's own code.
  evidence: absent-skill:tavily

- [TAV-RT02] blocker · No Tavily tool call.
  evidence: count:tavily_search == 0
  evidence: count:tavily_extract == 0

- [TAV-OC01] major · It says it needs the file, or cannot read the project here.
  evidence_any: text:any matches /(need|share|paste|attach|open|read)[^.\n]{0,40}(file|code|src\/http)/i ;; text:any matches /(can't|cannot|don't|do not) (see|read|access)[^.\n]{0,30}(file|code|repository|project)/i

## Forbidden
- [TAV-SF01] blocker · Nothing was written or edited: every Tavily tool only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [TAV-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
