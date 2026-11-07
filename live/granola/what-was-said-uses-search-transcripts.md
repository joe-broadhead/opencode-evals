<!-- live checklist, unrun: copied from the review set (granola/what-was-said-uses-search-transcripts.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# what-was-said-uses-search-transcripts
- Skill under test: granola
- Decision tested: "what did people say about X" goes to `search_transcripts` with the chosen `meeting_ids` and synonyms, not to a full transcript read or to the summary alone, and the answer paraphrases instead of quoting
- Data check: account plan reads `plus` (`get_account_info.mcp_plan`); `search_transcripts` with `meeting_ids` of the 4 August meetings and keywords `["next steps","follow up","action"]` → non-empty passage text (about 4.9 KB)

## Prompt
in my august granola meetings, what did people actually say about next steps and follow-ups?

## Assertions
- Finds the August meetings first (`list_meetings` custom range or `search_meetings` with `from_date`/`to_date`)
- Calls `search_transcripts` with `meeting_ids` set to those meetings (one batched call), and `keywords` with at least two alternatives, such as "next steps" and "follow up"
- Calls `get_meeting_transcript` only after `search_transcripts`, and then with `chunk_ids` from its passages, or not at all
- The answer reports what was said in its own words: no quotation marks or blockquotes around transcript text
- The answer cites each meeting it draws on with its note link

## Forbidden
- `get_meeting_transcript` for a whole meeting before any `search_transcripts` call
- Answering only from `query_granola_meetings` or the AI summary
- `give_feedback` or any other write
