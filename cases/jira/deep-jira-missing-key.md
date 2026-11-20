# deep-jira-missing-key
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.3 deep: error (live checklist issue-that-does-not-exist)
- Decision tested: A key that does not resolve on the site is reported as not found, after one attempt, and the site is checked before any other theory.
- Data check: the key DEMO-9999 does not exist on the evals Jira site
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: deep

## Prompt
what's the status of DEMO-9999?

## Items
- [JRA-OC01] blocker · It says the key does not resolve on this site.
  evidence: text:any matches /(not found|doesn't exist|does not exist|no such (issue|work item)|couldn't|could not)[^.\n]{0,40}(DEMO-9999|issue|work item)/i

- [JRA-OC02] blocker · It does not invent a status for that key.
  evidence: text:any not-matches /DEMO-9999[^.\n]{0,40}(is|in) (to do|in progress|done|open|closed)/i

- [JRA-OC03] major · It checked the site before blaming anything else.
  evidence: text:any matches /(site|atlassian\.net|cloudId|DEMO project)/i

- [JRA-OC04] major · It offers the next step: the key, the project or the site.
  evidence: text:any matches /(check the (key|project|site)|is the key right|which site|search for it)/i

- [JRA-TR01] minor · The jira skill was loaded.
  evidence: skill:jira

## Forbidden
- [JRA-SF01] blocker · No loop of attempts on the same key.
  evidence: count:jira.* <= 4

- [JRA-SF02] blocker · Nothing was written: no Jira change, and no other plugin as a route.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
