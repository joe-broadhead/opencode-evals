# route-no-3
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A meeting question is the notes plugins': no Jira call, and no invented decision.
- Data check: none
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=jira
- Set: route

## Prompt
what did we agree about the release date in Tuesday's meeting?

## Items
- [JRA-RT01] blocker · No Jira tool call.
  evidence: count:getJiraIssue == 0
  evidence: count:searchJiraIssuesUsingJql == 0

- [JRA-OC01] blocker · It does not state an agreement as fact.
  evidence: text:any not-matches /(^|[.!?]\s+|\n\s*[-*]?\s*)(we|you|the team) (agreed|decided|settled on)\b/i

- [JRA-OC02] major · It points at the meeting notes.
  evidence: text:any matches /(granola|wispr ?flow|meeting notes|notes app)/i

- [JRA-TR01] minor · No jira skill loaded for a meeting question.
  evidence: absent-skill:jira

## Forbidden
- [JRA-SF01] blocker · Nothing was written.
  evidence: absent:write

- [JRA-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
