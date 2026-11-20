# route-interview-content-1
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: overlap routing: Metaview holds what was said in an interview, Ashby holds the pipeline
- Decision tested: A what-did-they-say question reads the conversations with Metaview, and does not read Ashby for it
- Data check: the most recent candidate has a recorded onsite in the last 90 days
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: route

## Prompt
what did the most recent candidate say about distributed systems in their onsite?

## Items
- [MV-RT01] blocker · It read the conversations with Metaview.
  evidence: call:metaview.search_conversations#1
- [MV-RT02] blocker · It did not read Ashby for what was said.
  evidence: absent:ashby.*
- [MV-OC01] major · The answer reports what was said in the user's own words, cited by conversation and time.
  evidence: text:any matches /[0-9]+:[0-9]{2}/
- [MV-OC02] minor · It does not quote at length unless asked.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was written in either tool.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
