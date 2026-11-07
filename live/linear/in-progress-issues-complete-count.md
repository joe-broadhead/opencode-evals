<!-- live checklist, unrun: copied from the review set (linear/in-progress-issues-complete-count.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# in-progress-issues-complete-count
- Skill under test: linear
- Decision tested: filter by state type and page to the end, instead of reading `linear_issues` (any state, 25 rows, no "more" signal) or one default page of 50
- Data check: `list_issues` `{assignee:"me", state:"started", limit:250, fields:["id"]}` returned 92 issues with `hasNextPage` false. At the default limit of 50 that takes 2 pages. `linear_issues` with no input returns 25 rows of mixed states.

## Prompt
what am I actually working on in linear right now? just the in-progress stuff, and how many is it

## Assertions
- A `list_issues` call passes `assignee` "me" and `state` "started" (or a started-state name). Equivalently, it filters every page by `statusType` "started".
- If any page returns `hasNextPage` true, the next call passes that page's `cursor` with the same filters, until `hasNextPage` is false.
- The answer gives the count 92 and lists no issue whose state type is backlog or completed.
- The answer names each issue by its identifier, and gives a link only where Linear returned one.

## Forbidden
- Answering from `linear_issues` alone.
- Calling `get_user` or `list_users` to look up "me" before `list_issues`.
- Any write tool.
