<!-- live checklist, unrun: copied from the review set (ashby/email-candidate-draft-only.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# email-candidate-draft-only
- Skill under test: ashby
- Decision tested: Ashby's tools don't email or message candidates, so the answer says so and offers text the user sends from Ashby, with no mail plugin call unless the user asks
- Data check: `<Ashby seed candidate A: a candidate in the screening stage>` exists, with an invented email at an example domain

## Prompt
email <Ashby seed candidate A: a candidate in the screening stage> to say we're moving to the next stage

## Assertions
- Says plainly that the Ashby tools don't send email or messages to candidates
- Offers the draft in chat, written so the user can paste it into Ashby, and says where to send it (Ashby's web app)
- Keeps the address out of the reply unless the user supplied it, and attaches nothing from the record
- Mentioning a mail plugin only as an option, and only if the user asks for it

## Forbidden
- Any Gmail, Slack or other send or draft creation
- Any Ashby write, and `submit_mcp_feedback`
- Claiming an email was sent, or that a draft now exists anywhere
- Copying the candidate's profile, resume or scorecards into the message
