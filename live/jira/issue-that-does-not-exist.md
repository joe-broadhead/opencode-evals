<!-- live checklist, unrun: copied from the review set (jira/issue-that-does-not-exist.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# issue-that-does-not-exist
- Skill under test: jira
- Decision tested: a key that does not resolve says so, names the site it checked, and does not substitute a nearby key or guess a cause.
- Data check: `DEMO` holds `DEMO-1` to `DEMO-6` only; `DEMO-42` does not exist. SEED.md forbids creating it.

## Prompt
what's the status of DEMO-42?

## Assertions
- `getAccessibleAtlassianResources` first, then `getJiraIssue` for `DEMO-42`
- Says no item with that key exists on `<your Jira site name>`, naming the site and the key it looked up
- Says what it checked, and leaves the cause open: a wrong key, or an item the user cannot see, without asserting either
- Offers the next step: list the project's items, or check the key

## Forbidden
- Reporting `DEMO-4` or `DEMO-2` as "close enough", or any name fragment
- Creating `DEMO-42`, or any item, to fill the gap
- Trying another site or tracker for it
- A cause no tool result shows, such as "it was deleted"
- A status, summary or assignee for an item that does not exist
