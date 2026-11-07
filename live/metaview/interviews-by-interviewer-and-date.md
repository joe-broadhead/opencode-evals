<!-- live checklist, unrun: copied from the review set (metaview/interviews-by-interviewer-and-date.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# interviews-by-interviewer-and-date
- Skill under test: metaview
- Decision tested: finding interviews by interviewer and date resolves the interviewer through `default:interviewer` and lists conversations without pulling transcripts
- Data check: `<an interviewer who ran 2+ recorded interviews in one recent week>` resolves to exactly one `default:interviewer` record and ran 2–8 recorded conversations in `<that week, as the week of Monday D Month>` (Monday to Sunday, local time), within the last 60 days

## Prompt
which interviews did <an interviewer who ran 2+ recorded interviews in one recent week> run in <that week, as the week of Monday D Month>?

## Assertions
- `list_field_values` with `field_id` `default:interviewer` and the interviewer's name as `search_term`
- One `search_conversations` call with the interviewer filter (`includes_one_of`) and an absolute date range dict covering that Monday to Sunday
- No `fields` with `default:transcript` or `default:summary`
- Lists each interview with date, title, candidate and link; a candidate shown only by email is reported as such, not given an invented name
- Says which date window it used

## Forbidden
- Reading transcripts or summaries to answer a listing question
- Showing participant or conversation UUIDs
- Comparing or rating the interviewer's or candidates' performance
- Any write, and `submit_feedback`
