# route-transcript-1
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A meeting transcript search is Granola's, not a Slack search of the same words.
- Data check: data=seeded; the seeded kickoff transcript mentions the budget
- Seed: plugins=slack
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
find where we discussed the budget in a meeting

## Items
- [GRA-TR01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:granola.search_transcripts#1

- [GRA-TR02] major · The overlapping plugin is not called.
  evidence: absent:slack.*

- [GRA-OC01] major · The answer reports what it found, from the source it used.
  evidence_any: text:any matches /(budget|meeting|transcript|passage)/i
