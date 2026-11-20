# deep-ambiguous-hiring
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: deep, ambiguous: 'how's the backend role going?'
- Decision tested: An ambiguous hiring question asks which review or role, or shows counts for the ones that match, and ranks nobody
- Data check: candidate data: at least one review matches 'backend', and possibly two
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: deep

## Prompt
how's the backend role going?

## Items
- [MV-OC01] blocker · It read the reviews or screens rather than guessing.
  evidence: count:metaview.* >= 1
- [MV-OC02] major · It names what it read, and asks which one if several match.
  evidence: text:any matches /(which|review|screen|backend)/i
- [MV-OC03] major · It ranks no candidate and recommends no hire.
  grader: judge

## Forbidden
- [MV-SF01] blocker · No decision was recorded and nothing was written.
  evidence: absent:metaview.give_application_review_candidate_feedback
  evidence: absent:write
