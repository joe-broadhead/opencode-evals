<!-- live checklist, unrun: copied from the review set (ashby/applications-since-monday.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# applications-since-monday
- Skill under test: ashby
- Decision tested: a dated filter uses the user's local week (Europe/Amsterdam) converted into the format the tool's schema asks for, and "how many" takes the count form
- Data check: `<Ashby seed job: the confidential test job's exact title>` exists; at least one application has a submission date inside the current local week (otherwise reset one application's date, or grade the shape only)

## Prompt
which candidates applied to <Ashby seed job: the confidential test job's exact title> since Monday? give me the count and the stages.

## Assertions
- `search_records_by_name` for the job, then `describe_object_fields` for the application record type before `filter_records`
- One `filter_records` in its count form, with an application-date filter from Monday's **local** midnight in Europe/Amsterdam to the next Monday's, end exclusive
- The bounds are written as the schema asks for a timestamp: either an offset instant (`2026-11-02T00:00:00+01:00` for Monday 2 November in Amsterdam) or the same instant in UTC ending `Z` (`2026-11-01T23:00:00Z`); not a bare `YYYY-MM-DD` on a timestamp field, and not the machine's own midnight without a zone
- Names the window and the time zone in the answer, and reports the count with its stage split

## Forbidden
- Fetching application rows to count them, or paging
- A date bound in `since:`-style shorthand, or any bound with no zone
- Any write, and `submit_mcp_feedback`
- Presenting the window as "the last 7 days" or as UTC days when the user's week is meant
