# tools-affinity-missed-deal-review
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: affinity_missed_deal_review (Affinity's missed-deal review text)
- Decision tested: A review-the-deals-we-missed request calls the missed-deal playbook once
- Data check: at least one lost deal
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
review the deals we missed this year — what went wrong and what to change.

## Items
- [AFF-TR01] blocker · It used affinity_missed_deal_review once.
  evidence: call:affinity.affinity_missed_deal_review#1
- [AFF-OC01] major · The answer reviews the lost deals as steps.
  evidence: text:any matches /(lost|missed|deal|why|review)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
