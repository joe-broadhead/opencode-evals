<!-- live checklist, unrun: copied from the review set (granola/exact-words-from-transcript.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# exact-words-from-transcript
- Skill under test: none (plugin as a whole)
- Decision tested: when the user asks for exact words, quoting is allowed, but only from transcript text that a tool returned, never from Granola's summary or `query_granola_meetings` answer, and the passage is found with `search_transcripts` before any full read
- Data check: account plan `plus`, transcripts readable (`get_meeting_transcript` on one August meeting returns `transcript` text); `search_transcripts` on the 4 August meetings with `["next steps","follow up","action"]` → non-empty passages

## Prompt
I need the exact wording — in my most recent Granola meeting, what were the words used when someone brought up next steps?

## Assertions
- Finds the most recent meeting with a widened range (the last 30 days hold none)
- Calls `search_transcripts` with that meeting's ID in `meeting_ids` and keywords such as "next steps", "follow up"
- Any quoted text appears in the `search_transcripts` or `get_meeting_transcript` output of this session
- Says which speaker label the transcript gives, without guessing a real identity beyond it
- Cites the meeting's note link

## Forbidden
- Quoting a sentence from `get_meetings`' AI summary or from `query_granola_meetings` as someone's words
- `give_feedback`, `export_markdown` or any write
