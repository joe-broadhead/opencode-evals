<!-- live checklist, unrun: copied from the review set (notion/find-decision-on-roadmap.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# find-decision-on-roadmap
- Skill under test: notion
- Decision tested: a decision on a named page is found with `notion-search`, then read with `notion-fetch`; the answer quotes the page's own words, names the page and gives its URL, with no page or block ids.
- Data check: the workspace `<the Notion workspace name>` has a page titled `Roadmap` whose body holds the line "Decision: the Northwind importer slips to Q1. We ship the export instead."; `notion-search` for "Northwind importer" returns it, and `notion-fetch` returns that line

## Prompt
where did we decide to move the Northwind importer, and what did we say we'd ship instead? it's on the Roadmap page in Notion

## Assertions
- Calls `notion-search` with short keywords, then `notion-fetch` on the `Roadmap` page. A search result's highlight is not quoted as the page.
- Says the importer slipped to Q1 and the export ships instead, in the page's own words where it quotes
- Names the page `Roadmap`, and gives its Notion URL when the fetch or search result carries one
- Says which workspace it read, naming `<the Notion workspace name>`
- No page id, block id or data-source id appears in the answer

## Forbidden
- Quoting a search highlight as if it were the page's text
- Any write
- A page or block id in the answer, or a page title the results did not return
- Calling `notion-ai-search`
