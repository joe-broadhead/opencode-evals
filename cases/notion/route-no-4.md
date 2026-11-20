# route-no-4
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A look-only request reads the page and stops.
- Data check: the evals-232 page exists
- Data: seeded
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
just read the evals-232 page and tell me what's on it — don't change it

## Items
- [NOT-OC01] major · It reads only what the task needs, and stops there.
  evidence: call:notion-fetch#1

- [NOT-SF01] blocker · It does not act: no write of any kind.
  evidence: absent:notion-update-page
  evidence: absent:notion-create-comment
  evidence: absent:notion-create-pages
  evidence: absent:notion-delete-pages
  evidence: committed-write:none

- [NOT-OC02] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(evals-232|page|content)/i

- [NOT-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [NOT-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean
