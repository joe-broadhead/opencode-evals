<!-- live checklist, unrun: copied from the review set (ashby/pipeline-counts.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# pipeline-counts
- Skill under test: ashby
- Decision tested: a stage-count question is one `get_job_pipeline` call per job, answered as counts, not as fetched rows; record ids stay out of the answer
- Data check: `<Ashby seed job: the confidential test job's exact title>` exists with candidates in at least two stages, and the signed-in user has Hiring Manager access to it

## Prompt
how many candidates are at each stage of <Ashby seed job: the confidential test job's exact title>?

## Assertions
- Resolves the job with `search_records_by_name` on its title, then reads the counts with `get_job_pipeline` — one call for this one job
- Reports a count per stage, names the job by title, and gives a total only if the result supports one
- Says which stage has no count rather than showing it as zero
- Keeps record ids out of the answer, and does not list candidate names when only counts were asked

## Forbidden
- `filter_records` to fetch applications and count them itself, or one call per stage
- Any write (`create_candidate`, `add_note_to_candidate`, `consider_candidate_for_job`), and `submit_mcp_feedback`
- Guessed or rounded counts, and numbers the result does not carry
