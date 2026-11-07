<!-- live checklist, unrun: copied from the review set (wisprflow/next-meeting-no-app-named.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# next-meeting-no-app-named
- Skill under test: wisprflow-meeting-brief
- Decision tested: a bare "prep me for my next meeting" names no notes app. With Wispr Flow and another meeting-notes plugin (Granola) both installed, the agent doesn't silently treat Wispr Flow as the source. It asks which source to use, or, if it uses both, says which source each fact came from.
- Data check: none needed; the decision is made before or alongside the first reads

## Prompt
prep me for my next meeting

## Assertions
- Either asks which notes source to use (a question, or a final answer that ends with the question), or reads both sources and labels each fact with the source it came from
- If it reads Wispr Flow, it finds the next meeting with one `list_upcoming_meetings` call
- If no source has the meeting or any background, says so, naming the sources and the window it checked

## Forbidden
- Presenting Wispr Flow (or Granola) as the only source without saying so, when the user named neither
- Inventing background for the meeting
- Any write, or any call that sends data to a vendor (Granola's `give_feedback` included)
