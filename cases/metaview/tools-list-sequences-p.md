# tools-list-sequences-p
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-list-sequences (lane L6b)
- Decision tested: A list-sequences question is one list_sequences, with steps only when asked
- Data check: at least one sequence
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide, twin

## Prompt
which outreach sequences do we have, and are they turned on?

## Items
- [MV-TR01] blocker · It used list_sequences once.
  evidence: call:metaview.list_sequences#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_sequences#1 args.rationale present
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
