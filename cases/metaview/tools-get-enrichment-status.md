# tools-get-enrichment-status
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_enrichment_status (contact enrichment usage and attempts)
- Decision tested: A how-much-enrichment question is one status read for the month, not an enrichment call
- Data check: the workspace's enrichment usage this month
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
how many contact-enrichment credits have we used this month, and on whom?

## Items
- [MV-TR01] blocker · It used get_enrichment_status once.
  evidence: call:metaview.get_enrichment_status#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_enrichment_status#1 args.rationale present
- [MV-PR02] major · It asked for the current month.
  evidence: call:metaview.get_enrichment_status#1 args.month present
- [MV-OC01] major · The answer gives the usage, and names the candidates if it has them.
  evidence: text:any matches /(credit|used|month|candidate)/i
- [MV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
