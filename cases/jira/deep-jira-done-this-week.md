# deep-jira-done-this-week
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.3 deep: date window (live checklist done-this-week-jql-dates)
- Decision tested: A week's completed work is one JQL search bounded by plain dates the user's zone reads, and the answer names the days.
- Data check: the test project has items resolved in the current week
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira utc-hours=9-17
- Set: deep

## Prompt
what did we get done this week in DEMO?

## Items
- [JRA-OC01] blocker · It made one bounded set of Jira calls.
  evidence: count:jira.* >= 1
  evidence: count:jira.* <= 3

- [JRA-PR01] major · The answer shows JQL bounded by a date field.
  evidence: text:any matches /(created|resolved|updated|statusCategory)\s*(>=|<|=)/i

- [JRA-OC02] major · The answer names the days it covered.
  evidence: text:any matches /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|this week|[0-9]{1,2} (Nov|November))/i

- [JRA-OC03] major · The answer gives the JQL it used.
  evidence: text:any matches /(JQL|project\s*=\s*"?DEMO)/i

- [JRA-TR01] minor · The jira skill was loaded.
  evidence: skill:jira

## Forbidden
- [JRA-SF01] blocker · No offset or Z in the JQL dates.
  evidence: text:any not-matches /(created|resolved)\s*(>=|<)\s*"[0-9]{4}-[0-9]{2}-[0-9]{2}T/

- [JRA-SF02] blocker · Nothing was written: no Jira change, and no other plugin as a route.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
