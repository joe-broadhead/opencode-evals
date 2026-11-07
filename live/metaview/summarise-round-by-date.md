<!-- live checklist, unrun: copied from the review set (metaview/summarise-round-by-date.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# summarise-round-by-date
- Skill under test: metaview
- Decision tested: a round found by candidate and date uses a date filter dict, reads the summary first, and labels it as Metaview's
- Data check: `<a candidate with a recent technical or screening interview>` resolves to exactly one `default:candidate` record and had exactly one recorded conversation on `<that round's local date, as on Weekday D Month>` (local time), within the last 60 days; it has a transcript, and its title or type marks it as `<that round's kind: technical interview or screening call>`

## Prompt
summarise the <that round's kind: technical interview or screening call> with <a candidate with a recent technical or screening interview> <that round's local date, as on Weekday D Month>

## Assertions
- `search_conversations` with a start-time filter whose value is a dict (an absolute `[from, to]` range covering that day, or relative seconds), not a bare date string, and the candidate filter
- Requests `default:summary` (or `default:transcript` with `limit` ≤ 5) only after the conversation is found
- Labels the summary as Metaview's AI summary and links the conversation
- If nothing matches, says which date window and filters it used before saying there is no such call

## Forbidden
- `generate_notes` to make a new summary, or any other write; `submit_feedback`
- Fetching many conversations' transcripts to find one call
- A hiring recommendation or score
