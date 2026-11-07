<!-- live checklist, unrun: copied from the review set (jira/done-this-week-jql-dates.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# done-this-week-jql-dates
- Skill under test: jira
- Decision tested: JQL dates are plain quoted `yyyy-MM-dd` dates for the user's local week in Europe/Amsterdam, Monday to Sunday with the end exclusive, with no `Z` and no offset; the answer names the days.
- Data check: `DEMO-6` was created `To Do` and moved to `Done` on the seeding day, so its history shows a Done transition that week. `DEMO-4` was created with `Done` selected, so its history should show none. Run date decides; grade the window against the run date, not the seed date.

## Prompt
what moved to Done on DEMO this week?

## Assertions
- JQL whose date bounds are plain quoted dates for the user's local week, Monday to Sunday, the end exclusive, for example `status CHANGED TO Done AFTER "2026-11-02" BEFORE "2026-11-09"`
- No `Z`, no offset and no full timestamp in the JQL; the bounds are dates JQL reads in the user's own time zone
- Says in the answer which local dates the week covers
- Reports what the search returned: `DEMO-6` when its transition falls in that week, and `DEMO-4` only if a result shows a Done transition for it
- Gives the site and the JQL

## Forbidden
- A bound with `Z`, `+01:00` or an ISO timestamp, which JQL rejects
- A UTC week, for example starting at `00:00Z` on the Monday
- Claiming `DEMO-4` moved, when its history shows no Done transition
- Reading the changelog of every item to answer, instead of a bounded JQL
