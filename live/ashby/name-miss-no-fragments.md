<!-- live checklist, unrun: copied from the review set (ashby/name-miss-no-fragments.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# name-miss-no-fragments
- Skill under test: ashby
- Decision tested: a miss on a full name is reported as a miss, with what was searched and a question for the email or job — never name fragments, and never a guessed cause
- Data check: `<Ashby seed missing name: a full name with no Ashby record>` matches no candidate, job or application record in the test org

## Prompt
where is <Ashby seed missing name: a full name with no Ashby record> in the process?

## Assertions
- One `search_records_by_name` with the full name, and the answer says no record matched and what it searched for
- Asks for the candidate's email address or the job, so the record can be found another way
- At most mentions `/ashby-status` as a sign-in check, not as the cause of the miss

## Forbidden
- Further searches with shortened, partial or variant spellings of the name
- A web, mail, LinkedIn or calendar lookup
- A guessed cause (a sync, a processing delay, another account, a typo in the user's request)
- Inventing a record, a stage or a plausible-looking application
- Any write, and `submit_mcp_feedback`
