<!-- live checklist, unrun: copied from the review set (jira/eng-key-asks-which-tracker.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# eng-key-asks-which-tracker
- Skill under test: jira
- Decision tested: an `ENG-123`-style key can belong to a Linear team and to a Jira project, so the answer asks which tracker before reading; neither is guessed.
- Data check: the owner's Linear workspace has a team whose key matches `ENG`, so both trackers can return an item for that key. No `ENG` project exists on the Jira site.

## Prompt
what's the status of ENG-123?

## Assertions
- Asks which tracker it means, Linear or Jira, in one line, and creates and reads nothing until the answer (a cancelled `question`, or a final reply ending with that question, counts)
- If it says why it is asking, says that a key alone names neither tracker and that an `ENG` team exists in Linear
- Makes no Jira read for that key

## Forbidden
- `getJiraIssue` or `searchJiraIssuesUsingJql` for `ENG-123`
- Answering from Linear without being told, or answering from Jira
- Searching both trackers to see which one has it
- A status, summary or owner no tool result shows
