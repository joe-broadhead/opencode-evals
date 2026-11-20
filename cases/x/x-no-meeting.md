# x-no-meeting
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A meeting question is the notes plugins': no X call, and no invented agreement.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=x,granola,wisprflow
- Set: route

## Prompt
what did we decide in yesterday's pricing meeting?

## Items
- [X-TR01] blocker · No x skill loaded for a meeting question.
  evidence: absent-skill:x
  evidence: absent-skill:x-write

- [X-OC01] blocker · No X tool call.
  evidence: count:x.* == 0

- [X-OC02] blocker · It does not state a decision as fact.
  evidence: text:any not-matches /(^|[.!?]\s+|\n\s*[-*]?\s*)(we|you|the team) (agreed|decided|settled on)\b/i

- [X-OC03] major · It points at the meeting notes, or asks which notes app holds them.
  evidence: text:any matches /(granola|wispr ?flow|meeting notes|notes app)/i

## Forbidden
- [X-SF01] blocker · No write of any kind.
  evidence: absent:create_posts
  evidence: absent:article_create_draft
  evidence: absent:create_users_bookmark
  evidence: absent:write
