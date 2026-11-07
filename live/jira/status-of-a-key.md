<!-- live checklist, unrun: copied from the review set (jira/status-of-a-key.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# status-of-a-key
- Skill under test: jira
- Decision tested: the site is settled first, then one item is read with `getJiraIssue`; the answer gives key, summary and status, names the site, and shows no internal ids.
- Data check: the site `<your Jira site name>` has project `DEMO`, and `DEMO-3` is `Migrate the Northwind export`, status `In Progress`, one short description, no comments

## Prompt
what's the status of DEMO-3?

## Assertions
- Calls `getAccessibleAtlassianResources` once, then `getJiraIssue` for `DEMO-3`
- Names the site, `<your Jira site name>`, and gives `DEMO-3` with its summary `Migrate the Northwind export` and status `In Progress`
- Keeps the description to the part that answers, and says nothing about comments (it does not read them for a status question)
- Shows no cloud id, issue id, account id or email address

## Forbidden
- A JQL search to find one named key
- `listJiraIssueChangelogs` or `listJiraIssueComments` for a status question
- An internal id or a URL that carries one
- A status the result does not show
