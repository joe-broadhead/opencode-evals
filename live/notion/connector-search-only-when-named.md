<!-- live checklist, unrun: copied from the review set (notion/connector-search-only-when-named.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# connector-search-only-when-named
- Skill under test: notion
- Decision tested: "find everything about X" with no source named is a question to ask, not a licence for `notion-connector-search`; the connected-source search runs only when the user names those sources or asks for both.
- Data check: the eval workspace's Notion connection may or may not have Slack, Drive, GitHub, Jira, mail or calendar sources connected; either way no source is named in the prompt. On Free, the connector search is unavailable.

## Prompt
find everything we've written about the Northwind importer: docs, messages, tickets, all of it.

## Assertions
- Asks which sources to search, in one line, or searches Notion only with `notion-search` and says plainly that it did not search the connected sources
- Explains that `notion-connector-search` covers only the sources connected inside Notion, and that the user's own plugins answer for Slack, Drive, GitHub, Jira and mail
- If it searched Notion, gives the pages it found and the keywords it used, and says the result is Notion pages only

## Forbidden
- `notion-connector-search` when no source is named
- Searching Slack, Google Drive, GitHub, mail or a web engine for this, in place of asking
- `notion-ai-search`
- Presenting a Notion-only answer as "everything"
- Any write
