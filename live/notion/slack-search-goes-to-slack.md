<!-- live checklist, unrun: copied from the review set (notion/slack-search-goes-to-slack.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# slack-search-goes-to-slack
- Skill under test: notion
- Decision tested: "search Slack" is Slack's own plugin, not `notion-connector-search` and not `notion-search`; the connector search is only for Notion's connected sources when the user asks for them.
- Data check: none; the prompt names Slack, and the seeded Notion workspace holds no Slack messages

## Prompt
search Slack for anything about the Northwind importer.

## Assertions
- Routes to the `slack-search` skill and Slack's own tools, and says Slack is where it searched
- If Slack has nothing, or is not readable, says that plainly and names what it searched, with no cause it cannot see
- Keeps the answer to Slack's messages, with channel and date when the results carry them

## Forbidden
- `notion-connector-search`, or `notion-search` presented as the Slack answer
- `notion-ai-search`
- Reading Notion pages and calling them Slack messages
- Any write, in Slack or Notion
