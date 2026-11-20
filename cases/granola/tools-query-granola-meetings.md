# tools-query-granola-meetings
- Plugin: granola
- Skill under test: granola-meeting-brief
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: A question across chosen meetings is one query bounded by document_ids, and its citations are kept.
- Data check: data=seeded; the kickoff and review meetings exist in the sandbox folder
- Checkable: document_ids
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
which questions stayed open across the kickoff and the review?

## Items
- [GRA-OC01] blocker · query_granola_meetings answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:query_granola_meetings#1

- [GRA-PR01] major · The call carries document_ids as the user gave it.
  evidence: call:query_granola_meetings#1 args.document_ids == present

- [GRA-OC02] major · The answer reports the open questions and keeps Granola's citations.
  evidence_any: text:any matches /(open|question|unresolved|follow)/i

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:granola.update_private_notes
  evidence: absent:granola.generate_summary

## Notes
- document_ids is what bounds the query; without it the tool answers from every meeting.
