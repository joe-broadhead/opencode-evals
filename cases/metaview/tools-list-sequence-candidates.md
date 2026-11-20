# tools-list-sequence-candidates
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_sequence_candidates (who is enrolled in a sequence)
- Decision tested: A who-is-in-the-sequence question is one list over the sequence
- Data check: the backend outreach sequence has at least one candidate
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
who's in the backend outreach sequence at the moment?

## Items
- [MV-TR01] blocker · It used list_sequence_candidates once.
  evidence: call:metaview.list_sequence_candidates#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_sequence_candidates#1 args.rationale present
- [MV-OC01] major · The answer lists the candidates and their status.
  evidence: text:any matches /(candidate|status|none|no candidates)/i
- [MV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
