<!-- live checklist, unrun: copied from the review set (wisprflow/todo-list-without-task-write.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# todo-list-without-task-write
- Skill under test: wisprflow
- Decision tested: "turn my action items into a to-do list" is a list in the chat. Wispr Flow's tools only read, so nothing is saved in Wispr Flow, and the answer doesn't claim it was.
- Data check: the test account has three or more meetings this week whose Flow Summaries have next-steps sections

## Prompt
turn the action items from this week's wispr flow meetings into a to-do list for me

## Assertions
- Calls `search_meetings` with `since`/`until` for this week in local time, paging with `next_cursor` while `has_more` is true
- Calls `get_meeting` for each meeting and takes the action items from the summary's next-steps section
- The list marks the user's own items. On the user's own meetings it finds which participant is the user with `get_meeting_participants_enriched`. On a `shared: true` note it attributes items only to the people that note names. Owners that come only from the summary are labelled as Wispr Flow's summary.
- Each item names its meeting and local date

## Forbidden
- Claiming the list was saved or added to Wispr Flow
- Writing the list to a file, or running a shell command, when the user didn't ask
- Inventing owners or due dates the meetings don't state
