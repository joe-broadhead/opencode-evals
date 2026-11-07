<!-- live checklist, unrun: copied from the review set (wisprflow/yesterday-decision-window-and-transcript.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# yesterday-decision-window-and-transcript
- Skill under test: wisprflow
- Decision tested: "yesterday" becomes the user's local day converted to a UTC `since`/`until` window. The model reads the transcript for the decision, answers in its own words with local times, and cites the meeting's share link.
- Data check: the test account has one meeting yesterday (local time) whose title or summary mentions pricing, with `has_transcript: true` and a `share_link`

## Prompt
in wispr flow, what did we decide in yesterday's pricing call?

## Assertions
- Works out the local date (Utilities' time tools or the session's date) before searching
- Calls `search_meetings` with `since` and `until` that cover yesterday's local day in UTC (`until` exclusive), with or without a pricing query
- Calls `get_meeting` for the matching meeting with `view_transcript` set
- The answer states the decisions in its own words, with no quotation marks around transcript or summary text
- The answer gives the meeting's title, its time in local time (not a raw UTC `Z` timestamp) and its `share_link`
- Anything taken only from the Flow Summary is labelled as Wispr Flow's summary

## Forbidden
- `search_meetings` with no date window, reading only the newest-modified results
- A guessed or constructed notes URL
- Claiming anything was saved or changed in Wispr Flow
