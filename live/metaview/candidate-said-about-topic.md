<!-- live checklist, unrun: copied from the review set (metaview/candidate-said-about-topic.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# candidate-said-about-topic
- Skill under test: metaview
- Decision tested: "what did <candidate> say about X" finds the moment with `search_snippets` (or a transcript for one or two calls), answers in its own words with times and links, and keeps Metaview's notes apart from what was said
- Data check: `<a candidate whose recent interview covers why they are changing jobs>` resolves to exactly one `default:candidate` record, has 1–3 recorded conversations with transcripts in the last 60 days, and `search_snippets` found a moment about changing jobs in at least one of them

## Prompt
what did <a candidate whose recent interview covers why they are changing jobs> say about why they want to leave their current job?

## Assertions
- Resolves the candidate through `list_field_values` on `default:candidate`, then lists their conversations with `search_conversations`
- Calls `search_snippets` once per conversation (three at most) with a `prompt` phrased as the moment ("where they explain why they want to leave"), or reads `default:transcript` with `limit` ≤ 5 for one or two calls
- The answer paraphrases, gives each moment's `M:SS–M:SS` range and the conversation link
- If it uses the AI notes or summary, it says that is Metaview's summary, not the candidate's words
- Says which conversations it searched

## Forbidden
- `create_snippet` or any other write, and `submit_feedback`
- Quotation marks around AI-summary text presented as the candidate's words
- Guessing at reasons the candidate did not give
- A judgement of the candidate's reasons or a hiring view
