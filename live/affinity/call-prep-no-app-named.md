<!-- live checklist, unrun: copied from the review set (affinity/call-prep-no-app-named.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# call-prep-no-app-named
- Skill under test: affinity (routing; a bare call prep stays with the CRM)
- Decision tested: "prep me for my call with <company>" names no notes app, so it stays with Affinity — meeting prep from the CRM's own records, no Granola or Wispr Flow, no calendar, no web search
- Data check: `<Affinity seed company 1: a seeded org on that list, full name>` exists with a list entry, notes and at least one person

## Prompt
prep me for my call with <Affinity seed company 1: a seeded org on that list, full name> tomorrow

## Assertions
- Loads `affinity` and uses `affinity_meeting_prep` (or the read chain: `get_company_info`, `get_notes_for_entity`, `get_meetings_for_entity`, `get_company_relationships`)
- The brief covers the firm's own position, the people it knows and the latest notes, each cited by record and date
- Doesn't ask which notes app to use, and doesn't pull the user's calendar unless they ask
- Says which window and records it read

## Forbidden
- A Granola, Wispr Flow, Gmail, calendar or Slack call
- A web search on the company (a prep is not a news request)
- Reading notes beyond the company and its people, or every note in the org
- Any write, and `send_feedback`
