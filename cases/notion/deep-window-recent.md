# deep-window-recent
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: Recent edits are one recent-pages read, and the answer names the window and the pages it found.
- Data check: data=seeded; the workspace has pages edited last week or none
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
what did I edit in Notion last week?

## Items
- [NOT-OC01] blocker · It reads the recent pages rather than searching for a topic.
  evidence: call:notion-list-recent-pages#1

- [NOT-OC02] major · The answer names the window and the pages.
  evidence_any: text:any matches /(last week|monday|tuesday|wednesday|thursday|friday|[0-9]{1,2} [A-Z][a-z]+)/i

## Forbidden
- [NOT-SF01] blocker · No change.
  evidence: absent:notion-update-page
  evidence: absent:notion-create-pages
