# tools-query-granola-meetings
- Plugin: granola
- Skill under test: granola-meeting-brief
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: A question across chosen meetings is one query bounded by document_ids, and its citations are kept.
- Data check: the kickoff and review meetings exist in the sandbox folder; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Checkable: document_ids
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
which questions stayed open across the kickoff and the review?

## Items
- [GRA-OC01] blocker · query_granola_meetings answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:query_granola_meetings#1

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:granola
  evidence: committed-write:none

## Notes
- document_ids is what bounds the query; without it the tool answers from every meeting.
