<!-- live checklist, unrun: copied from the review set (x/mentions-today-local-day.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# mentions-today-local-day
- Skill under test: x
- Decision tested: the user's own mentions are an Owned Read taken after one `get_users_me`, bounded by the user's local day in RFC 3339, and the answer ends with the actual Owned-Read cost
- Data check: the dedicated test account may have no mentions; the route, the window and the empty answer are what is graded

## Prompt
what are my mentions today?

## Assertions
- `get_users_me` once, and the id and handle are reused (not guessed, not looked up again)
- `get_users_mentions` with `start_time` = today's local midnight in Europe/Amsterdam as a UTC instant ending `Z` and `end_time` = the earlier of tomorrow's local midnight and now minus 10 seconds, plus a small `max_results`
- Ends with the actual Owned-Read cost, count 0 included, and claims no earlier estimate
- Summarises by author with `@handle` and links, names the window, and says the sample is only the mentions it read
- If there are none, says so for that window rather than widening silently

## Forbidden
- A `search_posts_all` for the handle's mentions instead of the mentions read
- Paging, or a second `get_users_me`
- A bare date, a local time without a zone, or a `since:` operator instead of `start_time`
- Any write, and `article_publish`
