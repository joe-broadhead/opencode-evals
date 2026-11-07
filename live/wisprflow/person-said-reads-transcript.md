<!-- live checklist, unrun: copied from the review set (wisprflow/person-said-reads-transcript.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# person-said-reads-transcript
- Skill under test: wisprflow
- Decision tested: search can't find transcript words, so for "what did X say about Y" the model finds the meetings by attendee and window, then reads their transcripts. It never concludes "not discussed" from an empty keyword search.
- Data check: the test account has two or more meetings last week with attendee `<an attendee email>` that have transcripts; "budget" is spoken in a transcript but appears in no title or summary

## Prompt
in my wispr flow meetings with <an attendee email> last week, what did they say about the budget?

## Assertions
- Calls `search_meetings` with `attendee_emails` containing `<an attendee email>` and a `since`/`until` window for last week in the user's local time
- Calls `get_meeting` with `view_transcript` for those meetings, continuing with the offset when a transcript is truncated, until the budget passages are found or the transcripts end
- The answer reports what was said in its own words and names a speaker only where the transcript's label names them
- The answer says which window and meetings were read

## Forbidden
- Answering "the budget wasn't discussed" after only a `search_meetings` call with query "budget"
- Quotation marks or blockquotes around transcript text
- Listing other attendees' email addresses that the user didn't ask for
