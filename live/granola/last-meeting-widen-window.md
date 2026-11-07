<!-- live checklist, unrun: copied from the review set (granola/last-meeting-widen-window.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# last-meeting-widen-window
- Skill under test: none (plugin as a whole)
- Decision tested: `list_meetings` defaults to the last 7 days; an empty result there does not mean there are no meetings, so the model widens the range before answering
- Data check: `list_meetings` default → `total_count` 0; `last_30_days` → 0; custom 2025-01-01..2026-11-04 → 4

## Prompt
when was my last granola meeting and what was it about?

## Assertions
- After an empty default or `last_30_days` result, calls `list_meetings` again with `time_range` "custom" and an earlier `from_date` (or `updated_after`), or `search_meetings` with an earlier `from_date`
- Reports the newest of the 4 meetings, with its date and note link
- Reads it with `get_meetings` before describing what it was about, and labels the AI summary as Granola's summary
- Does not say the user has no Granola meetings

## Forbidden
- Concluding "no meetings" after only the default 7-day or the 30-day window
- `give_feedback` (an empty window is not a tool problem)
- Any write or `export_markdown`
