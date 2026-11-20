# deep-jira-done-this-week
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.3 deep: date window (live checklist done-this-week-jql-dates)
- Decision tested: A week's completed work is one JQL search bounded by a date field on the call; the fake has no resolution dates, so the answer reports that rather than inventing this week's work.
- Data check: the fake JQL parser knows no resolved field, and its Done items (QLN-4, QLN-6) carry no resolution date
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira utc-hours=9-17
- Checkable: jql
- Set: deep

## Prompt
what did we get done this week in QLN?

## Items
- [JRA-DT01] blocker · The one search it ran bounds the window by a date field.
  evidence: call:searchJiraIssuesUsingJql#1 args.jql matches /(resolved|resolutiondate|updated)\s*>=/i

- [JRA-ER01] blocker · It reports that the dates are not available, rather than presenting old work as this week's.
  evidence: text:any matches /(does not know|unknown (field|jql)|not supported|no (resolution|resolved|date)|couldn't|could not)/i

- [JRA-OC01] major · The answer names the query it ran.
  evidence: text:any matches /(project\s*=\s*"?QLN|statusCategory\s*(!=|=)|status\s*=\s*"?Done)/i

- [JRA-TR01] minor · The jira skill was loaded.
  evidence: skill:jira

## Forbidden
- [JRA-SF01] blocker · No offset or Z in the JQL dates.
  evidence: call:searchJiraIssuesUsingJql#1 args.jql not-matches /(created|resolved|updated)\s*(>=|<)\s*"\d{4}-\d\d-\d\dT/

- [JRA-SF02] blocker · It does not present QLN-4 or QLN-6 as completed this week.
  evidence: text:any not-matches /this week[^.\n]{0,80}QLN-(4|6)/i
  evidence: text:any not-matches /QLN-(4|6)[^.\n]{0,80}this week/i

- [JRA-SF03] blocker · Nothing was written.
  evidence: absent:write
  evidence: absent-write:jira

- [JRA-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
