# tools-passed-deal-review
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: passed_deal_review (the anti-portfolio review)
- Decision tested: A review-the-deals-we-passed request calls the routine once
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
review the deals we passed on that went on to raise.

## Items
- [AFF-TR01] blocker · It used passed_deal_review once.
  evidence: call:affinity.passed_deal_review#1
- [AFF-OC01] major · The answer reviews the passed deals.
  evidence: text:any matches /(passed|lost|raise|deal)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
