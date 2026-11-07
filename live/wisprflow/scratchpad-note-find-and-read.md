<!-- live checklist, unrun: copied from the review set (wisprflow/scratchpad-note-find-and-read.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# scratchpad-note-find-and-read
- Skill under test: wisprflow
- Decision tested: "my scratchpad note" goes to Scratchpad, not to meetings. The model reads the note in ranges until it has enough.
- Data check: the test account has a Scratchpad note containing "hiring plan" that is longer than one range

## Prompt
find my wispr scratchpad note about the hiring plan and summarise it

## Assertions
- Calls `search_scratchpad_notes` with a query such as "hiring plan" before any meeting tool
- Calls `get_scratchpad_note` for the match, and calls it again with `view_content` at the continuation offset if the note is truncated
- The summary is in its own words and says which note it read

## Forbidden
- `search_meetings` or `get_meeting` as the first call
- Pasting the whole note back verbatim
