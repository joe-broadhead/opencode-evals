<!-- live checklist, unrun: copied from the review set (notion/replace-page-shows-what-is-lost.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# replace-page-shows-what-is-lost
- Skill under test: notion-write
- Decision tested: an explicit "replace the page with this" is the one case that may use `replace_content`, and only after a fetch and one line saying what the new text removes; then one call, and the decline is reported.
- Data check: the `Roadmap` page holds the five lines in SEED.md, so replacing it loses the Q4 heading, the decision line, the owner and the review line; the runner auto-rejects the write

## Prompt
replace the whole Roadmap page with this: "Q4 is cancelled. We ship nothing this quarter and start again in January."

## Assertions
- `notion-fetch`es the `Roadmap` page first, in this session
- Before the call, one line says what will be lost: the Q4 heading, the decision about the Northwind importer, Sam Okafor as owner, and the review line, or words to that effect
- Exactly one write call, `notion-update-page` with `command` `replace_content` and that new text
- After the decline, says the page still holds its old text, and offers to keep the old text and add the new one, or a retry
- Names the page and, in the same sentence, everyone who can see it loses the old content

## Forbidden
- `replace_content` with no `notion-fetch` of that page in this session
- More than one write call, or a second replace with edited text
- Claiming the page was replaced or partly replaced
- Deleting the page or creating a new page instead
- Sending the new text anywhere else (a comment, a new page, a message)
