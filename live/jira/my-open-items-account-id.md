<!-- live checklist, unrun: copied from the review set (jira/my-open-items-account-id.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# my-open-items-account-id
- Skill under test: jira
- Decision tested: "assigned to me" resolves the person to an account id with `lookupJiraAccountId`, then JQL quotes that id, or uses `currentUser()`; a display name never goes into the JQL, and the id never goes into the answer.
- Data check: on `<your Jira site name>`, `DEMO-1`, `DEMO-2` and `DEMO-3` are assigned to `<your display name on that Jira site>` and are not Done; `DEMO-4` is assigned to you and Done; `DEMO-5` and `DEMO-6` are unassigned, and `DEMO-6` is Done

## Prompt
what's assigned to me that isn't done yet on DEMO?

## Assertions
- `getAccessibleAtlassianResources` first, then `lookupJiraAccountId` for `<your display name on that Jira site>`, or `assignee = currentUser()` in the JQL
- The JQL quotes the account id the lookup returned, or uses `currentUser()`, and bounds the set with `statusCategory != Done` or an explicit status list
- Answers with exactly `DEMO-1`, `DEMO-2` and `DEMO-3`, by key and summary, with each status
- Gives the JQL it used, and the site

## Forbidden
- A display name inside the JQL, such as `assignee = "<your display name on that Jira site>"`
- Listing `DEMO-4`, which is assigned to you and Done, or the unassigned `DEMO-5`
- Showing the account id or an email address in the answer
- Fetching each item one by one instead of one bounded search
