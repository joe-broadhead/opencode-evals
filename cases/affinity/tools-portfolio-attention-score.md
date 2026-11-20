# tools-portfolio-attention-score
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: portfolio_attention_score (Affinity's attention routine)
- Decision tested: A which-portfolio-companies-need-attention request calls the routine once
- Data check: affinity: portfolio companies with recent activity
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which portfolio companies need my attention this month?

## Items
- [AFF-OC01] blocker · It used portfolio_attention_score once.
  evidence: count:affinity.portfolio_attention_score == 1
- [AFF-OC02] major · The answer names the companies and why, from the CRM.
  evidence: text:any matches /(portfolio|attention|company|why)/i

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
