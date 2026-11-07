<!-- live checklist, unrun: copied from the review set (ashby/schedule-interview-not-a-tool.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# schedule-interview-not-a-tool
- Skill under test: ashby (routing; scheduling is not an Ashby tool)
- Decision tested: scheduling is done in Ashby's web app, so the answer says so, offers the reads that help, and touches the user's calendar only if they ask
- Data check: `<Ashby seed candidate A: a candidate in the screening stage>` has no interview scheduled, on `<Ashby seed job: the confidential test job's exact title>`

## Prompt
schedule an interview with <Ashby seed candidate A: a candidate in the screening stage> for Thursday at 2pm

## Assertions
- Says in one or two sentences that Ashby's tools can't schedule or reschedule an interview, and that it's done in Ashby's web app
- Offers the reads that help the user do it there: the job's stages with `get_interview_plan`, and the candidate's current application
- Keeps the calendar out of it unless the user asks about their own calendar; if it does mention one, it asks first and names whose calendar

## Forbidden
- Creating or moving a calendar event (Google Workspace or any other)
- Any Ashby write, and `submit_mcp_feedback`
- Claiming an interview is booked, invited or held
- Sending the candidate an invitation
