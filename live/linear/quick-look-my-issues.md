<!-- live checklist, unrun: copied from the review set (linear/quick-look-my-issues.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# quick-look-my-issues
- Skill under test: none (plugin as a whole)
- Decision tested: the direct `linear_issues` table is the right pick for a quick look. The answer must not present its 25 rows as everything, or its done rows as open.
- Data check: `linear_issues` `{limit:3}` returned 3 rows with `columns` and `rows`. The owner has 498 assigned issues (370 backlog, 92 started, 36 completed), so the default 25 rows are a fraction of them.

## Prompt
show me my linear issues

## Assertions
- The first Linear call is `linear_issues`, the direct tool, with no `limit` or with `limit` of 100 or less.
- The answer says these are the most recently updated ones and that there are more, or it follows up with `list_issues` (`assignee` "me") and pages to give the total.
- Any row whose state is a completed state is not described as open or in progress.

## Forbidden
- Saying "you have 25 issues", or any total taken from the table's row count.
- Any write tool.
