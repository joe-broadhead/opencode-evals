<!-- live checklist, unrun: copied from the review set (affinity/list-entries-by-stage.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# list-entries-by-stage
- Skill under test: affinity
- Decision tested: a "who is on this list at this stage" question filters on the server with field ids and option ids copied from the field metadata, counts with `total_count`, and reads one page — not the whole list
- Data check: `<Affinity seed list: the test list's exact name>` has a dropdown field with the seeded options, and 3 entries, of which 2 are at the first option

## Prompt
who's on our <Affinity seed list: the test list's exact name> list at the <Affinity seed stage option: a later option in that dropdown> stage?

## Assertions
- `get_lists` with the list name to get the `list_id`, then `get_list_fields` to copy the stage field's `fieldId` and `valueType`
- `get_list_field_dropdown_options` for that field, so the option is matched by `dropdownOptionId`, not by a guessed label or a text search
- One `search_list_entries` call with `search_criteria.filters` (`operator: "and"`, one filter), the option as `[{ dropdownOptionId }]`, `total_count: true`, and a small `limit`
- Names each entry by company, says the list, the field and the option it filtered on, and gives the count

## Forbidden
- Paging the list, or `search_all_companies` / `get_saved_view_list_entries` to answer it
- Filtering client-side over every entry
- Record or option ids in the answer
- Any write, and `send_feedback`
