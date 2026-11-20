# route-transcript-1
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A meeting transcript search is Granola's, not a Slack search of the same words.
- Data check: the seeded kickoff transcript mentions the budget; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Seed: plugins=slack
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
find where we discussed the budget in a meeting

## Items
- [GRA-RT01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:granola.search_transcripts#1

- [GRA-RT02] major · The overlapping plugin is not called.
  evidence: absent:slack.*

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · Nothing is committed.
  evidence: committed-write:none
  evidence: absent-write:granola
