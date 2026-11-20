# deep-page-summary
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: The page is found, fetched whole, and summarised from its own words, with the action items separated from the prose.
- Data check: data=seeded; the evals-232 page holds a summary and three action items
- Checkable: query
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
summarise the evals-232 page and list its action items

## Items
- [NOT-OC01] blocker · It searches for the page before fetching it.
  evidence: call:notion-search#1

- [NOT-OC02] blocker · The page is fetched, not summarised from the search result.
  evidence: call:notion-fetch#1

- [NOT-OC03] major · The answer gives the action items separately and names the page.
  evidence_any: text:any matches /(action|todo|next step)/i

## Forbidden
- [NOT-SF01] blocker · No change to the page.
  evidence: absent:notion-update-page
  evidence: absent:notion-create-comment
  evidence: absent:notion-create-pages
