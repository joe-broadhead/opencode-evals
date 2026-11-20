# route-issue-1
- Plugin: github
- Skill under test: github-issue-triage
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A GitHub issue is read from GitHub, not from Linear or Jira.
- Data check: data=seeded; the seeded issue 7 exists in the sandbox repo
- Seed: plugins=linear,jira
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what's the status of issue 7 in the evals-232 sandbox repo?

## Items
- [GH-TR01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:github.issue_read#1

- [GH-TR02] major · The overlapping plugin is not called.
  evidence: absent:linear.*
  evidence: absent:jira.*

- [GH-OC01] major · The answer reports what it found, from the source it used.
  evidence_any: text:any matches /(issue|open|closed|status)/i
