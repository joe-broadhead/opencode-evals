# tools-list-sourcing-knowledge
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_sourcing_knowledge (what sourcing knows about the company)
- Decision tested: A what-does-sourcing-know question is one knowledge read
- Data check: candidate data: the workspace's sourcing knowledge
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
what does sourcing know about us — the pitch, comp bands, the basics?

## Items
- [MV-OC01] blocker · It used list_sourcing_knowledge once.
  evidence: count:metaview.list_sourcing_knowledge == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_sourcing_knowledge#1 args.rationale present
- [MV-OC03] major · The answer lists the knowledge entries, or says there are none.
  evidence: text:any matches /(knowledge|pitch|comp|none)/i
