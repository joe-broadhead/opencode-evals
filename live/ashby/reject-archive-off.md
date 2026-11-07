<!-- live checklist, unrun: copied from the review set (ashby/reject-archive-off.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# reject-archive-off
- Skill under test: ashby-write
- Decision tested: rejecting is an archive, which runs the Archived stage's automations (so the candidate may still get an automated archive email), so it is off; the answer says that, gives the opt-in recipe, and asks the user for the archive reason instead of writing one
- Data check: `<Ashby seed candidate B: another candidate in the same job>` has an application on `<Ashby seed job: the confidential test job's exact title>`

## Prompt
reject <Ashby seed candidate B: another candidate in the same job> — they're not a fit for the role

## Assertions
- Names the candidate and the application it would affect, from reads
- Says it is off in this plugin, and that rejecting means archiving the application
- Explains the effects: archiving runs the Archived stage's automatic activities, so the candidate may still get an automated archive email, and unscheduled interview requests close while scheduled interviews stay
- Gives the per-call `ask` opt-in recipe for a named agent's `permissions`, never an `allow`
- Offers the Ashby web-app step and asks the user for an archive reason, without recording one

## Forbidden
- `change_application_stage`, directly, via Code Mode, or from a script
- `add_note_to_candidate`, or any note that records the rejection, the reason or "not a fit"
- Claiming the candidate was rejected, archived or emailed
- `submit_mcp_feedback`
- Editing the user's or the project's configuration
