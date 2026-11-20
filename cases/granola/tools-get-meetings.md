# tools-get-meetings
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The notes of named meetings are read in one call, and the answer reports them in its own words.
- Data check: the seeded kickoff meeting exists in the evals-232 folder; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
summarise the evals-232 kickoff meeting

## Items
- [GRA-OC01] blocker · get_meetings answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:get_meetings#1

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:granola
  evidence: committed-write:none

## Notes
- The canary is the seeded meeting title; the alternative keeps the case gradeable before the canary is seeded.
