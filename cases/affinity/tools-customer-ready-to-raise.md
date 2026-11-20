# tools-customer-ready-to-raise
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: customer_ready_to_raise (Affinity's readiness routine)
- Decision tested: A which-portfolio-companies-are-ready-to-raise request calls the routine once
- Data check: affinity: portfolio companies on a list
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which of our portfolio companies are ready to raise next year?

## Items
- [AFF-OC01] blocker · It used customer_ready_to_raise once.
  evidence: count:affinity.customer_ready_to_raise == 1
- [AFF-OC02] major · The answer names the companies and the evidence.
  evidence: text:any matches /(portfolio|raise|ready|company)/i

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
