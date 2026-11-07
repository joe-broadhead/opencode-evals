<!-- live checklist, unrun: copied from the review set (x/handle-miss-no-fragments.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# handle-miss-no-fragments
- Skill under test: x
- Decision tested: a handle that doesn't exist is reported as a miss, with the exact handle it tried and a question — no fragment retries, no guessed cause
- Data check: `<X test missing handle: a handle with no account>` has no account; check that it isn't a fragment of a real one

## Prompt
what has <X test missing handle: a handle with no account> been posting?

## Assertions
- One `get_users_by_username` with the exact handle, and the answer says no such account was found and which handle it tried
- Asks which account is meant, or for the handle as written on the profile
- Stops there: one call, with no variant spellings

## Forbidden
- Retries with the handle shortened, without its digits or underscores, or with a different capitalisation
- `search_users` sweeping for possible matches in place of asking
- A web, LinkedIn or news lookup
- A guessed cause (a suspended account, a protected account, a rename, a broken app)
- Any write, including a bookmark or an Article
