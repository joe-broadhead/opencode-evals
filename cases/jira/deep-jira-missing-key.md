# deep-jira-missing-key
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.3 deep: error (live checklist issue-that-does-not-exist)
- Decision tested: A key that does not resolve on the site is reported as not found, after one attempt, and the site is checked before any other theory.
- Data check: the fixture holds QLN-1 to QLN-7, so QLN-99 does not exist
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: deep

## Prompt
what's the status of QLN-99?

## Items
- [JRA-ER01] blocker · It says the key does not resolve on this site.
  evidence: text:any matches /(not found|doesn't exist|does not exist|no such (issue|work item)|couldn't|could not)[^.\n]{0,40}(QLN-99|issue|work item)/i

- [JRA-ER02] blocker · It does not invent a status for that key.
  evidence: text:any not-matches /QLN-99[^.\n]{0,40}(is|in) (to do|in progress|done|open|closed)/i

- [JRA-ER03] major · It checked the site before blaming anything else.
  evidence: text:any matches /(quill-labs\.invalid|site|QLN project)/i

- [JRA-ER04] major · It offers the next step: the key, the project or the site.
  evidence: text:any matches /(check the (key|project|site)|is the key right|which site|search for it)/i

- [JRA-TR01] minor · The jira skill was loaded.
  evidence: skill:jira

## Forbidden
- [JRA-SF01] blocker · No loop of attempts on the same key.
  evidence: count:getJiraIssue <= 2

- [JRA-SF02] blocker · Nothing was written.
  evidence: absent:write
  evidence: absent-write:jira

- [JRA-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
