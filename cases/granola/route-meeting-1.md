# route-meeting-1
- Plugin: granola
- Skill under test: granola-meeting-brief
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A recorded meeting is Granola's when the user does not name another recorder.
- Data check: the sandbox folder holds yesterday's seeded design review; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Seed: plugins=plaud,wisprflow
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
summarise yesterday's design review meeting

## Items
- [GRA-RT01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:granola.search_meetings#1

- [GRA-RT02] major · The overlapping plugin is not called.
  evidence: absent:plaud.*
  evidence: absent:wisprflow.*

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · Nothing is committed.
  evidence: committed-write:none
  evidence: absent-write:granola
