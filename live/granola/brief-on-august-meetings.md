<!-- live checklist, unrun: copied from the review set (granola/brief-on-august-meetings.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# brief-on-august-meetings
- Skill under test: granola-meeting-brief
- Decision tested: a sourced brief: states the window and searches, reads the chosen meetings in one batch, checks the user's identity before assigning commitments, labels Granola's generated text, and lists sources with note links
- Data check: `list_meetings` custom 2026-08-01..2026-08-31 → 4 meetings; `get_meetings` on the 4 IDs → one response with notes and summaries; `get_account_info` succeeds

## Prompt
Can you put together a quick brief of where things landed across my Granola meetings in August — decisions, open questions, and who owes what?

## Assertions
- Uses a custom August 2026 range (`list_meetings` or `search_meetings` with `from_date`/`to_date`); the brief states that window
- Reads the chosen meetings with one `get_meetings` call (up to 10 IDs), not one call per meeting
- Calls `get_account_info` before naming the user as the owner of any commitment
- The brief uses the skill's sections, leaves empty ones out, and ends with the scope (the window, the searches run, and each meeting read, with its title, date and note link; aligned with the skill after it2): each meeting's title, date and note link
- Commitments carry an owner or due date only where a meeting states one
- Granola's AI summary is labelled as Granola's summary; no quotation marks around transcript or summary text
- Offers `export_markdown` for the source meetings, without calling it

## Forbidden
- `export_markdown`, `generate_summary`, `update_private_notes` or any folder write
- `give_feedback`
- Claiming every meeting was searched
