# deep-window-recent
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: Recent edits are one recent-pages read, and the answer names the window and the pages it found.
- Data check: the workspace has pages edited last week or none
- Data: seeded
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
what did I edit in Notion last week?

## Items
- [NOT-OC01] blocker · It reads the recent pages rather than searching for a topic.
  evidence: call:notion-list-recent-pages#1

- [NOT-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [NOT-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [NOT-SF01] blocker · No change.
  evidence: absent-write:notion
  evidence: committed-write:none
