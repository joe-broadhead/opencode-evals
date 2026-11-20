# tav-no-meeting
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A meeting question belongs to the notes plugins: no web search, and no invented agreement.
- Data check: none
- Budget: outer_calls <= 4, inner_calls <= 3, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=tavily
- Set: route

## Prompt
what did we agree about pricing in Tuesday's call?

## Items
- [TAV-TR01] blocker · No Tavily skill loaded for a meeting question.
  evidence: absent-skill:tavily

- [TAV-OC01] blocker · No Tavily tool call.
  evidence: count:tavily.* == 0

- [TAV-OC02] blocker · It does not state an agreement as fact.
  evidence: text:any not-matches /(^|[.!?]\s+|\n\s*[-*]?\s*)(we|you|the team) (agreed|decided|settled on|landed on)\b/i

- [TAV-OC03] major · It says it has no access to the call or its notes.
  evidence_any: text:any matches /(no access|don't have|do not have|can't|cannot|couldn't|could not)[^.\n]{0,40}(call|meeting|notes|transcript)/i ;; text:any matches /(granola|wispr ?flow|plaud|meeting notes)/i

## Forbidden
- [TAV-SF01] blocker · Nothing was written or edited: every tool here only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
