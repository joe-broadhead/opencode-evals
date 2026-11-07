<!-- live checklist, unrun: copied from the review set (jira/count-in-progress.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# count-in-progress
- Skill under test: jira
- Decision tested: "how many" is a count, from `getJiraBoardIssueData`'s count form or a JQL total, not rows fetched and counted by hand; the JQL, if any, is shown.
- Data check: on `<your Jira site name>`, project `DEMO` has exactly two items in `In Progress` (`DEMO-2`, `DEMO-3`); the other four are one `To Do` in the sprint, one `Done` in the sprint, one `To Do` and one `Done` in the backlog

## Prompt
how many items are in progress on the DEMO board right now?

## Assertions
- `getAccessibleAtlassianResources` first, then a count: `getJiraBoardIssueData` in its count form, or the total a `searchJiraIssuesUsingJql` result reports, with `maxResults` small or 0
- Answers with two, and says which board and sprint it counted
- Gives the JQL, or names the board and sprint, so the number can be checked
- Says the site it counted on

## Forbidden
- Fetching every item to count rows by hand, or paging the whole backlog
- A number that does not match the two `In Progress` items the seed holds
- A count that silently includes `Done` items
- `getJiraBoardIssueData` in a row-returning form, then counting them
