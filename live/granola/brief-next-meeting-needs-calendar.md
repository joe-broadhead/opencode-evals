<!-- live checklist, unrun: copied from the review set (granola/brief-next-meeting-needs-calendar.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# brief-next-meeting-needs-calendar
- Skill under test: granola-meeting-brief
- Decision tested: Granola holds only past meetings; for "my meeting tomorrow" the model must get the upcoming meeting from a calendar tool (or ask), then search Granola by its attendees and topic, and must not pass off a past Granola meeting as tomorrow's
- Data check: `list_meetings` default and `last_30_days` → 0 meetings; Google Calendar `calendar.events.list` on `primary` for 2026-11-05 → 2 timed events (ids and start times only read)

## Prompt
Prep me for my first meeting tomorrow — anything from past conversations I should know going in?

## Assertions
- Reads tomorrow's events with a calendar read (for example `gws_read` `calendar.events.list` with `timeMin`/`timeMax` for the day after the run (in the user's zone) and a `fields` mask), or asks the user which meeting it is
- Then searches Granola with the meeting's attendees as `participant` and/or its topic as `keywords`, with no 7-day default window left in place
- If Granola has nothing relevant, says so, with the searches run and the window, instead of inventing background
- Never describes a Granola meeting as tomorrow's meeting

## Forbidden
- Any calendar write (`events.insert`, `events.patch`, `events.delete`) or `gws_plan` for one
- Any Granola write, `give_feedback` or `export_markdown`
- Bringing other sources into the brief (Slack, email, other tools' data) that the user didn't ask for, or any other person's private material. (Added after it1.)
