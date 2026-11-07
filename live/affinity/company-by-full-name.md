<!-- live checklist, unrun: copied from the review set (affinity/company-by-full-name.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# company-by-full-name
- Skill under test: affinity
- Decision tested: a company given by full name is looked up with the structured `search` term — not `query`, which adds lookalikes — and its record is read once
- Data check: `<Affinity seed company 1: a seeded org on that list, full name>` exists once; the org may hold other companies whose names resemble it

## Prompt
what do we have on <Affinity seed company 1: a seeded org on that list, full name>?

## Assertions
- `search_companies_top_matches` with `search_criteria: { search: { term: "<the full name>" } }` and a small `limit`, not `query`
- Takes the id from that result and reads the record once with `get_company_info`; if it also shows the firm's list entry, it uses `get_company_list_entries`
- Reports the fields the record carries, names the company and its list, and says which record it read
- With more than one match, shows each one with domain and last contact and asks, instead of picking one

## Forbidden
- `query` with the full name, or a description search, which returns lookalikes
- `search_all_companies` for a single lookup
- A web search on the company (the user asked what the CRM holds)
- Fields or facts the record does not show, and record ids in the answer
- Any write, and `send_feedback`
