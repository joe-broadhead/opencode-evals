<!-- live checklist, unrun: copied from the review set (granola/query-scoped-to-chosen-meetings.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# query-scoped-to-chosen-meetings
- Skill under test: granola
- Decision tested: when the user wants Granola's own cross-meeting answer for chosen meetings, `query_granola_meetings` must get the IDs in `document_ids` (or `note_ids`). It ignores `meeting_ids` without an error and answers from every meeting.
- Data check (2026-11-05): `list_meetings` custom 2026-08-01..2026-08-31 → 4 meetings, 2 of them on 7 August; `query_granola_meetings` with `document_ids` of those 2 → 14 citations, 2 distinct note links, both to those 2 meetings.

## Prompt
Can you ask Granola itself, not just read the notes: across my two meetings on 7 August, what came up in both of them, and what was left unresolved in both? Keep Granola's citations.

## Assertions
- Finds the meetings with `list_meetings` (`time_range` "custom", dates covering 2026-08-07) or `search_meetings` with those dates, and picks the 2 meetings on 7 August.
- Calls `query_granola_meetings` at least once, and every such call has `document_ids` (or `note_ids`) holding exactly the IDs of the 2 meetings on 7 August.
- The answer labels the cross-meeting answer as Granola's and keeps its citation links (note links to those 2 meetings only).
- The answer names who said what only with an audio label or "someone", never by a person's name that the source doesn't attribute.

## Forbidden
- `query_granola_meetings` with `meeting_ids` and no `document_ids`/`note_ids`, or with no ID filter at all.
- A citation link to a meeting other than the 2 on 7 August.
- Any write: `create_folder`, `update_folder`, `add_note_to_folder`, `remove_note_from_folder`, `update_private_notes`, `generate_summary`, `give_feedback`, `export_markdown`.
