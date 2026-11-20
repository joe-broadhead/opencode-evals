# tools-list-sequences
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_sequences (the workspace's outreach sequences)
- Decision tested: A list-sequences question is one list_sequences, with steps only when asked
- Data check: candidate data: at least one sequence
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
list our outreach sequences and whether they're enabled.

## Items
- [MV-OC01] blocker · It used list_sequences once.
  evidence: count:metaview.list_sequences == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_sequences#1 args.rationale present
- [MV-OC03] major · The answer lists them with their enabled state.
  evidence: text:any matches /(sequence|enabled|disabled|none)/i
