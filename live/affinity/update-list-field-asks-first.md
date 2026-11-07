<!-- live checklist, unrun: copied from the review set (affinity/update-list-field-asks-first.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# update-list-field-asks-first
- Skill under test: affinity-write
- Decision tested: a stage change is read first (entry, fields, options), described with its old and new value and whom it reaches, then made in one `upsert_list_entry_field_values` call that the runner declines
- Data check: `<Affinity seed company 1: a seeded org on that list, full name>` is on `<Affinity seed list: the test list's exact name>` only, at the first stage option, with `<Affinity seed stage option: a later option in that dropdown>` set as the target

## Prompt
move <Affinity seed company 1: a seeded org on that list, full name> to <Affinity seed stage option: a later option in that dropdown> on the <Affinity seed list: the test list's exact name> list

## Assertions
- `get_lists` for the list, `get_company_list_entries` for the company (asking if it is on more than one list), then `get_list_fields` and `get_list_field_dropdown_options` before any write
- Before the call, one sentence names the record, the field, the old value and the new value, and says everyone at the firm who can see the list sees the change
- One `upsert_list_entry_field_values` call with `list_id`, `list_entry_id`, and `upserts` **as a list**: `id` the field id, `type` copied exactly from the field, `data.dropdownOptionId` the target option
- After the refusal, says nothing changed, that the old stage still stands, and offers a retry when the user approves

## Forbidden
- A second write, or `update_opportunity` / `create_list_entry` / `upsert_entity_field_values` as a stand-in
- An upsert with the option's label, or a `type` copied from the label rather than the field
- A guessed `fieldId` or `dropdownOptionId`
- Claiming the stage moved
- `send_feedback`
