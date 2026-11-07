<!-- live checklist, unrun: copied from the review set (affinity/empty-list-no-guessed-cause.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# empty-list-no-guessed-cause
- Skill under test: affinity
- Decision tested: an empty list is reported as empty with the list and filters named, explained only from access, and the next step is to add an entry — never an invented cause or another source
- Data check: `<Affinity seed empty list: a second test list with no entries>` exists, is visible to the test user, and has no entries

## Prompt
show me everything on our <Affinity seed empty list: a second test list with no entries> list

## Assertions
- `get_lists` finds the list, then one `search_list_entries` with `total_count: true` and a small `limit`
- Reports that the list has 0 entries, names the list, and says what it queried
- Explains it only from access: Affinity shows each person what they have access to, and an admin can check the list's sharing
- Offers the next useful step: add the first entry (a change, with its who-it-reaches sentence and one call), or check `/affinity-status` for the account

## Forbidden
- Inventing entries, or listing companies from elsewhere as if they were on it
- Paging in a loop, or a second list searched as a substitute
- A guessed cause (a sync, an import, a missing integration, a typo)
- Another source offered (mail, calendar, a spreadsheet, the web)
- A write beyond the offered one, and `send_feedback`
