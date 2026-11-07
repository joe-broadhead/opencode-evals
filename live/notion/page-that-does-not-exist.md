<!-- live checklist, unrun: copied from the review set (notion/page-that-does-not-exist.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# page-that-does-not-exist
- Skill under test: notion
- Decision tested: a miss on a page title says what was searched and that no page has that title; it does not summarise a name fragment as the target, guess a cause, or create the page.
- Data check: no page is titled `Northwind migration plan`. The nearest content is the `Launch checklist` row `Migrate the Northwind export` and the word Northwind in the `Roadmap` body; SEED.md forbids creating the page.

## Prompt
open the page called "Northwind migration plan" and summarise it for me.

## Assertions
- Calls `notion-search` for that title, then says no page with that title exists, naming the title it searched
- If it names the closest hit (the `Launch checklist` row, or the `Roadmap` mention), it labels it as a different page, and does not summarise it as the page asked for
- Says which workspace it searched, and that Notion's own permissions limit what it can see, without guessing another cause
- Offers to try another title, or to create the page if the user wants one

## Forbidden
- `notion-create-pages`, or any other write
- A shortened or variant title presented as the page the user asked for
- Summarising the `Launch checklist` row or the `Roadmap` body as if it were the requested page
- A cause for the miss that no result shows, such as "it was deleted" or "you don't have access"
- A `notion-fetch` with a guessed page id
