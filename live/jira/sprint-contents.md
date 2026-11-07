<!-- live checklist, unrun: copied from the review set (jira/sprint-contents.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# sprint-contents
- Skill under test: jira
- Decision tested: a sprint is found through the board (`listJiraBoards`, then sprint data or the sprint list), not guessed in JQL, and only its items are listed.
- Data check: on `<your Jira site name>`, `Demo sprint 1` is active on `Demo board` and holds `DEMO-1` (To Do), `DEMO-2` (In Progress), `DEMO-3` (In Progress) and `DEMO-4` (Done); `DEMO-5` and `DEMO-6` are in the backlog

## Prompt
what's in the current sprint on the DEMO board?

## Assertions
- `getAccessibleAtlassianResources`, then `listJiraBoards` for project `DEMO`, then `getJiraBoardSprintData` for the active sprint, or `listJiraBoardSprints` and then one sprint
- Names the sprint `Demo sprint 1` and the board, and says it is the active one
- Lists exactly `DEMO-1` to `DEMO-4`, each by key and summary with its status
- Says the site it read

## Forbidden
- A JQL clause that guesses the sprint by name, such as `sprint = "Demo sprint 1"`
- Listing `DEMO-5` or `DEMO-6` as if they were in the sprint
- Listing every item in the project as the sprint
- An issue id or board id in the answer, instead of key, summary and board name
