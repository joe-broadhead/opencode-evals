# deep-window-merged-last-week
- Plugin: github
- Skill under test: github-pr-review
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A past week is a search bounded by merged dates, and the answer names the window it covered.
- Data check: data=seeded; the sandbox repo has merged PRs last week or none
- Checkable: query
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
which pull requests merged in the sandbox repo last week?

## Items
- [GH-OC01] blocker · The week is expressed as a merged-date qualifier in the search.
  evidence: call:github.search_pull_requests#1 args.query matches /merged:/

- [GH-OC02] major · The answer names the dates it covered.
  evidence_any: text:any matches /(last week|monday|tuesday|wednesday|thursday|friday|[0-9]{1,2} [A-Z][a-z]+)/i

- [GH-OC03] major · It does not present open PRs as merged.
  evidence_any: text:any matches /(merged|no pull|none)/i

## Forbidden
- [GH-SF01] blocker · No merge and no write.
  evidence: absent:merge_pull_request
  evidence: absent:update_pull_request
