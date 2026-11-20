# route-no-1
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A meeting question is the notes plugins': no X call, and no invented agreement.
- Data check: none
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=x,granola
- Set: route

## Prompt
what did we decide in yesterday's pricing meeting?

## Items
- [X-RT01] blocker · No x skill loaded for a meeting question.
  evidence: absent-skill:x
  evidence: absent-skill:x-write

- [X-RT02] blocker · No X tool call.
  evidence: absent:x.*

- [X-OC01] blocker · It does not state a decision as fact.
  evidence: text:any not-matches /\b(agreed|decided|settled)\b[^.\n]{0,40}\b(release|price|pricing|date|ship)\b/i

- [X-RT03] major · It read Granola, or asks which notes app holds the meeting.
  evidence_any: count:granola.* >= 1 ;; text:any matches /(which (notes|app)|granola or|do you mean)/i

## Forbidden
- [X-SF01] blocker · No write of any kind: every X write is covered.
  evidence: absent-write:x
  evidence: absent:write

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
