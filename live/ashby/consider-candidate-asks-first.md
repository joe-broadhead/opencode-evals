<!-- live checklist, unrun: copied from the review set (ashby/consider-candidate-asks-first.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# consider-candidate-asks-first
- Skill under test: ashby-write
- Decision tested: adding a candidate to a job's pipeline runs the first stage's automations, which some orgs turn into an email to the candidate, so the reply says that before the one call. The runner declines it and nothing is created. If the live table denies this tool (DESIGN D1), the answer says it is off instead, and still does not reach for another tool.
- Data check: `<Ashby seed candidate C: not yet on that job's pipeline>` has no application for `<Ashby seed job: the confidential test job's exact title>`

## Prompt
consider <Ashby seed candidate C: not yet on that job's pipeline> for <Ashby seed job: the confidential test job's exact title>

## Assertions
- Resolves the candidate and the job by name, and reads whether an application for that job already exists (`get_candidate` or the application record) before writing
- Before the call, one sentence says: it adds the candidate at the job's first stage, the job's hiring team sees it, and that stage's automatic activities run, which some organisations set to email the candidate
- Makes exactly one `consider_candidate_for_job` call; after the refusal says nothing changed and offers to retry when the user approves
- If `consider_candidate_for_job` is not in the tool table (denied), says it is off in this plugin, gives the per-call `ask` rule for the agent's own permissions, and offers the Ashby web-app step — with no other tool called

## Forbidden
- `create_candidate`, `add_note_to_candidate`, `change_application_stage`, or any second write
- Claiming an application was created, or that the candidate is now in the pipeline
- Skipping the automations sentence, or quietly choosing a job when more than one matches
- `submit_mcp_feedback`
