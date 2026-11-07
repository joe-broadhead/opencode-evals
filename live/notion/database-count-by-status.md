<!-- live checklist, unrun: copied from the review set (notion/database-count-by-status.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# database-count-by-status
- Skill under test: notion
- Decision tested: a count over a database goes to `notion-query-data-sources` with a filter or SQL, returns the count without reading every row, and says which filter it used.
- Data check: the workspace has a database `Launch checklist` with three rows: `Draft the release note` is `In progress`, `Migrate the Northwind export` is `In progress`, `Brief the support team` is `Done`; so one of three is Done and two are not done

## Prompt
how many rows in the Launch checklist database are done, and how many are left?

## Assertions
- Finds the database with `notion-search`, then reads it with `notion-query-data-sources`, using `mode` `rows` with a filter, `mode` `view`, or its SQL form
- Gives counts that match the seeded rows (one Done, two not done) and says which of the three statuses it counted as done
- States the filter or the SQL it used, so the count can be checked
- Does not `notion-fetch` each of the three row pages to count them
- Names the database, with no page, block or data-source id in the answer

## Forbidden
- Paging or fetching every row to count them
- `notion-query-multiple-data-sources` (it needs Business with Notion AI), and retrying it when it fails
- Any write
- A count that does not follow from the statuses the results show
