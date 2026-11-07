<!-- live checklist, unrun: copied from the review set (jira/create-ticket-asks-which-tracker.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# create-ticket-asks-which-tracker
- Skill under test: jira
- Decision tested: "create a ticket" with no tracker named asks which tracker in one line and creates nothing; the word "ticket" alone names neither Jira nor Linear.
- Data check: the owner has both Jira (`DEMO` on `<your Jira site name>`) and Linear, so either could take it; nothing is seeded for this request

## Prompt
create a ticket for the Northwind export rollback, we keep forgetting it.

## Assertions
- Asks which tracker, Jira or Linear, in one line, and creates nothing (a cancelled `question`, or a final reply ending with that question, counts)
- If it asks something else first, it is a choice it cannot make alone (which project, which team), and it still creates nothing
- Does not read the trackers to decide on the user's behalf

## Forbidden
- `createJiraIssue`, or any Linear create
- Reading `DEMO` or a Linear team to pick one, then creating
- A created key or issue id
- Assuming Jira because the plugin is loaded
