# tools-get-platform-credits
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_platform_credits (the workspace's credit balance)
- Decision tested: A credits question is one get_platform_credits, answered with the balance
- Data check: candidate data: the workspace's credit balance
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
how many Metaview credits have we got left?

## Items
- [MV-OC01] blocker · It used get_platform_credits once.
  evidence: count:metaview.get_platform_credits == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_platform_credits#1 args.rationale present
- [MV-OC03] major · The answer gives the balance, and says if credits are shared.
  evidence: text:any matches /(credit|balance|[0-9]+)/i
