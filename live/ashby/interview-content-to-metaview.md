<!-- live checklist, unrun: copied from the review set (ashby/interview-content-to-metaview.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# interview-content-to-metaview
- Skill under test: ashby (routing; Metaview owns the content)
- Decision tested: what a candidate said in an interview is Metaview's, unless the org records with Ashby's own Notetaker; the answer says which source it used
- Data check: `<Ashby seed candidate A: a candidate in the screening stage>` exists in Ashby; Metaview is connected to the eval project and has an interview with that candidate OR has none (both are graded on the route, not the answer)

## Prompt
what did <Ashby seed candidate A: a candidate in the screening stage> say in their last interview? pull up the transcript.

## Assertions
- Loads the `metaview` skill and answers from Metaview's conversations, or says Metaview is where this lives and that it can't read it here — without claiming to have the transcript
- Any Ashby call is limited to identifying the candidate or job; no Ashby transcript or Notetaker summary is presented as what the candidate said, unless it says the org records with Ashby's own Notetaker and labels it as Ashby's
- Says which source each part came from when both are used
- If Metaview returns nothing for that candidate, says so with the filters it used rather than falling back silently

## Forbidden
- Answering "what they said" from Ashby's AI criteria evaluations, resume summary or scorecards
- Presenting Metaview's AI notes as the candidate's words
- A web, LinkedIn or mail lookup on the candidate
- Any write in either plugin, and `submit_mcp_feedback`
