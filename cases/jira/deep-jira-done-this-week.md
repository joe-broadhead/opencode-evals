# deep-jira-done-this-week
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.3 deep: date window (live checklist done-this-week-jql-dates)
- Decision tested: A week's completed work is one JQL search bounded by plain dates the user's zone reads, and the answer names the days.
- Data check: the fixture holds two Done items (QLN-4 and QLN-6)
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira utc-hours=9-17
- Set: deep

## Prompt
what did we get done this week in QLN?

## Items
- [JRA-DT01] blocker · It searched once, with a bounded window.
  evidence: count:searchJiraIssuesUsingJql >= 1
  evidence: count:searchJiraIssuesUsingJql <= 2

- [JRA-PR01] major · The answer shows JQL bounded by a date field.
  evidence: text:any matches /(created|resolved|updated|statusCategory)\s*(>=|<|=)/i

- [JRA-DT02] major · The answer names the days it covered.
  evidence: text:any matches /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|this week|[0-9]{1,2} (Nov|November))/i

- [JRA-OC01] major · It reports the fixture's Done items.
  evidence: text:any matches /QLN-(4|6)/

- [JRA-TR01] minor · The jira skill was loaded.
  evidence: skill:jira

## Forbidden
- [JRA-SF01] blocker · No offset or Z in the JQL dates.
  evidence: text:any not-matches /(created|resolved)\s*(>=|<)\s*"[0-9]{4}-[0-9]{2}-[0-9]{2}T/

- [JRA-SF02] blocker · Nothing was written.
  evidence: absent:write

- [JRA-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
