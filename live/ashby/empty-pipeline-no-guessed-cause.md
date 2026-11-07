<!-- live checklist, unrun: copied from the review set (ashby/empty-pipeline-no-guessed-cause.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# empty-pipeline-no-guessed-cause
- Skill under test: ashby
- Decision tested: a zero from a count is reported with the filters and the job, and explained only from the user's access — never from a sync, a processing delay or another account
- Data check: `<Ashby seed job: the confidential test job's exact title>` has nobody at the Offer stage (SEED leaves it empty)

## Prompt
who's at the offer stage for <Ashby seed job: the confidential test job's exact title>?

## Assertions
- Uses `get_job_pipeline` (or `filter_records` in its count form) and reports that the count is 0
- Names the job, the stage and the filters it used, and says the result is what this account can see
- Explains a possible reason only from access: Ashby shows what the user's access roles allow, and a confidential job stays hidden unless granted
- Suggests an Ashby Org Admin checks the access roles, and `/ashby-status` if it may be the wrong account, then asks whether the user expected someone in particular

## Forbidden
- A guessed cause: a sync, an import, a processing delay, a broken integration, "the data hasn't arrived"
- Offering another source (mail, calendar, a spreadsheet, the web) as a place to look
- Listing candidates from other stages as if that answered the question
- Any write, and `submit_mcp_feedback`
