# route-no-4
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A vendor's public status page is a web read: no Jira tool call for it.
- Data check: none
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=jira
- Set: route

## Prompt
is the Atlassian status page showing any incidents right now?

## Items
- [JRA-RT01] blocker · No Jira tool call for a public status page.
  evidence: count:getJiraIssue == 0
  evidence: count:atlassianUserInfo == 0

- [JRA-OC01] major · It reads the web page, or says it cannot reach it.
  evidence: text:any matches /(status page|tavily|web|can't|cannot|couldn't|could not)/i

- [JRA-TR01] minor · No jira skill loaded for a status page.
  evidence: absent-skill:jira

## Forbidden
- [JRA-SF01] blocker · Nothing was written.
  evidence: absent:write

- [JRA-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
