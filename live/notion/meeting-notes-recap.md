<!-- live checklist, unrun: copied from the review set (notion/meeting-notes-recap.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# meeting-notes-recap
- Skill under test: notion
- Decision tested: a page the user wrote is read with `notion-fetch` and summarised in the agent's own words, with no invented decision, owner or date; a written page is not a Notion AI meeting note.
- Data check: the workspace has a page `Weekly sync notes` with three bullets and one action line naming Dana Ortiz. It is hand-written, not a Notion AI meeting note.

## Prompt
summarise the Weekly sync notes page for me: what was decided, and who owns what?

## Assertions
- Finds the page with `notion-search` and reads it with `notion-fetch`
- Reports the decision (the export ships before the importer), the support constraint and the December point, each in its own words
- Names Dana Ortiz as the owner of the one action, and gives no owner for anything the page leaves unowned
- Names the page, and says which workspace it read when it names one
- Adds no decision, date, deadline or owner that the page does not contain

## Forbidden
- `notion-query-meeting-notes` in place of fetching the page the user named
- Any write, including a comment or a new page holding the summary
- A decision or an owner the page does not state
- Quoting a search highlight as the page's text
