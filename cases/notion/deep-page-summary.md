# deep-page-summary
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: The page is found, fetched whole, and summarised from its own words, with the action items separated from the prose.
- Data check: the evals-232 page holds a summary and three action items; content unchecked
- Data: seeded
- Checkable: query
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
summarise the page {{target:notion.sandbox_page}} and list its action items

## Items
- [NOT-OC01] blocker · It searches for the page before fetching it.
  evidence: call:notion-search#1

- [NOT-OC02] blocker · The page is fetched, not summarised from the search result.
  evidence: call:notion-fetch#1

- [NOT-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [NOT-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [NOT-SF01] blocker · No change to the page.
  evidence: absent-write:notion
  evidence: committed-write:none
