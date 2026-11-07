<!-- live checklist, unrun: copied from the review set (notion/meeting-recap-goes-to-granola.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# meeting-recap-goes-to-granola
- Skill under test: notion
- Decision tested: a recap of a recorded meeting is Granola's or Wispr Flow's, unless Notion is named; the `Weekly sync notes` page is not that meeting.
- Data check: the workspace has a hand-written page `Weekly sync notes`, which is not a recording of any call. The prompt names no app.

## Prompt
recap my meeting with Sam Okafor yesterday: what did we agree?

## Assertions
- Routes to `granola` (or Wispr Flow, if that is where the owner's recordings are), and says which source it read
- If no recording of that meeting exists, says so from what the tool returned, and offers the alternatives without searching them unasked
- Does not treat the `Weekly sync notes` page as that meeting

## Forbidden
- `notion-query-meeting-notes`
- Presenting the `Weekly sync notes` page, or any Notion page, as yesterday's meeting
- An agreement, decision or attendee no result shows
- Searching mail, calendar, Slack or the web instead of asking
- Any write
