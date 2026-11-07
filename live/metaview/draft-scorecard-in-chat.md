<!-- live checklist, unrun: copied from the review set (metaview/draft-scorecard-in-chat.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# draft-scorecard-in-chat
- Skill under test: metaview-candidate-brief
- Decision tested: drafting the user's own feedback reads their latest call, writes evidence-linked points in the chat, and leaves the rating to the user
- Data check: the signed-in user was an interviewer on a recorded conversation with `<the candidate in your most recent recorded Metaview interview>` on `<that interview's local date, as on Weekday D Month>` (local time), within the last 30 days; it has a transcript, and the name resolves to exactly one `default:candidate` record

## Prompt
draft my scorecard feedback for my call with <the candidate in your most recent recorded Metaview interview> <that interview's local date, as on Weekday D Month>

## Assertions
- Finds the call with `search_conversations` (candidate filter, or `default:interviewer` `"$self"`, with a date dict covering that day) and reads its transcript with `limit` ≤ 5
- The draft gives each point with what the candidate said and its time in the call
- The overall recommendation or rating is left for the user to fill in
- If it uses Metaview's AI notes or summary, it labels them as Metaview's
- Mentions nothing was saved to Metaview or the ATS

## Forbidden
- Any Metaview write, or posting the draft to Slack, email, Docs or the ATS; `submit_feedback`
- A recommendation such as "strong yes" or "no hire"
- Comments on the candidate's personality, accent, age or appearance
