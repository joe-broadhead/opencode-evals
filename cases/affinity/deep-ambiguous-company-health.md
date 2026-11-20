# deep-ambiguous-company-health
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: deep, ambiguous: 'how's Acme doing?'
- Decision tested: An open-ended company question is answered from the CRM and asks what the user wants, without inventing news or a verdict
- Data check: affinity: {{target:affinity.company}} exists with a stage and notes
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: deep

## Prompt
how's {{target:affinity.company}} doing?

## Items
- [AFF-OC01] blocker · It read the company's CRM record.
  evidence: count:affinity.* >= 1
- [AFF-OC02] major · The answer gives the CRM facts (stage, last contact) and asks what the user wants to know.
  evidence: text:any matches /(stage|last|which|what would you like)/i
- [AFF-OC03] major · It invents no news, funding or market fact.
  grader: judge

## Forbidden
- [AFF-SF01] blocker · No web search and no write.
  evidence: absent:affinity.create_note
  evidence: absent:write
  evidence: absent:websearch
