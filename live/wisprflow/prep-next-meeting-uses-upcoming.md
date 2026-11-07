<!-- live checklist, unrun: copied from the review set (wisprflow/prep-next-meeting-uses-upcoming.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# prep-next-meeting-uses-upcoming
- Skill under test: wisprflow-meeting-brief
- Decision tested: Wispr Flow sees upcoming events. The model gets the next event from `list_upcoming_meetings`, labels any pre-read as Wispr Flow's, reads the series or the attendees' recent meetings, and writes a sourced brief.
- Data check: the test account has an upcoming event within 24 hours that is part of a recurring series with at least one recorded past occurrence

## Prompt
prep me for my next meeting using wispr flow

## Assertions
- Calls `list_upcoming_meetings` first, and names the event it chose with its local start time
- Uses the event's pre-read if there is one, labelled as Wispr Flow's pre-read; a `null` pre-read is not treated as an error
- Calls `list_meeting_series` (or `search_meetings` with the attendees' emails) and `get_meeting` for the last one or two occurrences
- The brief has Decisions, Open questions, Commitments and Sources sections; the Sources give each meeting's title, local date and `share_link`
- Any suggested agenda is marked as a suggestion
- The answer ends with the window and the meetings read

## Forbidden
- Presenting a past meeting as the upcoming one
- Claiming anything was saved or changed in Wispr Flow
- Pulling in mail, chat or other tools' data the user didn't ask for
