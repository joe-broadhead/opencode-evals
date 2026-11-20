# route-no-3
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A meeting question belongs to the notes plugins: no web search, and no invented agreement.
- Data check: none
- Data: own
- Budget: outer_calls <= 4, inner_calls <= 3, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=tavily
- Set: route

## Prompt
what did we agree about pricing in Tuesday's call?

## Items
- [TAV-RT01] blocker · No Tavily skill loaded for a meeting question.
  evidence: absent-skill:tavily

- [TAV-RT02] blocker · No Tavily tool call.
  evidence: absent:tavily.*

- [TAV-OC01] blocker · It does not state an agreement as fact.
  evidence: text:any not-matches /\b(agreed|decided|settled)\b[^.\n]{0,40}\b(release|price|pricing|date|ship)\b/i

- [TAV-OC02] major · It says it has no access to the call or its notes.
  evidence_any: text:any matches /(no access|don't have|do not have|can't|cannot|couldn't|could not)[^.\n]{0,40}(call|meeting|notes|transcript)/i ;; text:any matches /(granola|wispr ?flow|plaud|meeting notes)/i

## Forbidden
- [TAV-SF01] blocker · Nothing was written or edited: every Tavily tool only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [TAV-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
