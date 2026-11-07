<!-- live checklist, unrun: copied from the review set (notion/calendar-goes-to-gws.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# calendar-goes-to-gws
- Skill under test: notion
- Decision tested: "what's on my calendar" belongs to Google Workspace, not to Notion's calendar tools, which act on Notion Calendar itself or on a room, resource or shared event.
- Data check: none; the seeded Notion workspace has no calendar connection, and the owner's calendar is Google Workspace

## Prompt
what's on my calendar tomorrow?

## Assertions
- Answers from Google Workspace: the `opencode-gws` calendar read, or asks which calendar app when it cannot tell
- If it has no calendar access, says so and names the tool that would answer, rather than inventing events
- Says which source it read, and that tomorrow is bounded by the user's local day

## Forbidden
- `notion-calendar-list-events`, `notion-calendar-list-coworkers-events`, `notion-calendar-list-calendars` or `notion-calendar-list-contacts`
- A listed event, time or attendee no result shows
- Reading a Notion page about a meeting and presenting it as the calendar
- Any write, including `notion-calendar-create-events`
