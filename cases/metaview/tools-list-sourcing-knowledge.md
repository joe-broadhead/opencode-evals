# tools-list-sourcing-knowledge
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_sourcing_knowledge (what sourcing knows about the company)
- Decision tested: A what-does-sourcing-know question is one knowledge read
- Data check: the workspace's sourcing knowledge
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
what does sourcing know about us — the pitch, comp bands, the basics?

## Items
- [MV-TR01] blocker · It used list_sourcing_knowledge once.
  evidence: call:metaview.list_sourcing_knowledge#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_sourcing_knowledge#1 args.rationale present
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
