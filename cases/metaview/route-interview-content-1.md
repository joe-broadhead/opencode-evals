# route-interview-content-1
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: overlap routing: Metaview holds what was said in an interview, Ashby holds the pipeline
- Decision tested: A what-did-they-say question reads the conversations with Metaview, and does not read Ashby for it
- Data check: candidate data: {{target:metaview.candidate}} has a recorded onsite in the last 90 days
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: route

## Prompt
what did {{target:metaview.candidate}} say about distributed systems in their onsite?

## Items
- [MV-RL01] blocker · It read the conversations with Metaview.
  evidence: count:metaview.* >= 1
- [MV-RL02] blocker · It did not read Ashby for what was said.
  evidence: absent:ashby.*
- [MV-OC01] major · The answer reports what was said in the user's own words, cited by conversation and time.
  evidence: text:any matches /[0-9]+:[0-9]{2}/
- [MV-OC02] minor · It does not quote at length unless asked.
  grader: judge

## Forbidden
- [MV-SF01] blocker · Nothing was written in either tool.
  evidence: absent:write
  evidence: absent:metaview.create_snippet
