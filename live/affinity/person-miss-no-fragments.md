<!-- live checklist, unrun: copied from the review set (affinity/person-miss-no-fragments.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# person-miss-no-fragments
- Skill under test: affinity
- Decision tested: a miss on a full name is reported as a miss with what was searched and a question for the company, domain or list — no name fragments, no guessed cause
- Data check: `<Affinity seed missing name: a full name with no Affinity record>` matches no person in the test organisation

## Prompt
what's the latest on <Affinity seed missing name: a full name with no Affinity record>?

## Assertions
- One `search_persons` with the full name as the `search` term and a small `limit`
- Says no person matched in what this account can see, and what it searched for
- Asks for the company, the domain or the list, so the record can be found another way
- If it mentions access at all, it is the CRM's own rule (each person sees what they have access to), plus an Affinity admin or `/affinity-status` as a check

## Forbidden
- Further searches with shortened, partial or variant spellings, or with a first name only
- `search_all_companies` or a notes/files search to hunt for the person
- A web, mail or LinkedIn lookup
- A guessed cause (a sync, a missing integration, a typo, "the record may not have synced yet")
- Any write, and `send_feedback`
