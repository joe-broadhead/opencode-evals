# tools-get-platform-credits
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_platform_credits (the workspace's credit balance)
- Decision tested: A credits question is one get_platform_credits, answered with the balance
- Data check: the workspace's credit balance
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
how many Metaview credits have we got left?

## Items
- [MV-TR01] blocker · It used get_platform_credits once.
  evidence: call:metaview.get_platform_credits#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_platform_credits#1 args.rationale present
- [MV-OC01] major · The answer gives the balance, and says if credits are shared.
  evidence: text:any matches /(credit|balance|[0-9]+)/i
- [MV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
