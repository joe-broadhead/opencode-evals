<!-- live checklist, unrun: copied from the review set (affinity/notes-window-local-days.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# notes-window-local-days
- Skill under test: affinity
- Decision tested: a "last N days" window is the user's local days in Europe/Amsterdam, end exclusive, written as UTC instants ending `Z` in `filter_expr`, and Affinity's AI summaries are labelled as Affinity's
- Data check: `<Affinity seed company 1: a seeded org on that list, full name>` has one note inside the last 7 local days and one older note, so the window changes the answer

## Prompt
what notes did we add to <Affinity seed company 1: a seeded org on that list, full name> in the last 7 days?

## Assertions
- Resolves the company, then calls `get_notes_for_entity` with that `entity_id`, `entity_type: 1`, and a `filter_expr` of the form `createdAt>=<instant> & createdAt<<instant>`
- The two instants are the local midnight 7 days ago and today's local midnight in Europe/Amsterdam, converted to UTC and ending in `Z` (for a run on 6 November at UTC+1: `2026-10-30T23:00:00Z` and `2026-11-05T23:00:00Z`), end exclusive
- Names the window and the time zone in the answer, and says how many notes matched
- Summarises each note in its own words, and labels an AI Notetaker summary or transcript as Affinity's

## Forbidden
- A bare `YYYY-MM-DD` bound inside `filter_expr`, or a bound with no zone, or the machine's own midnight
- Paging every note, or `search_notes` across all records for one company's notes
- Presenting an AI Notetaker summary as what was said
- Any write, and `send_feedback`
