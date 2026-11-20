# route-relationship-1
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: overlap routing: who-knows-them is the CRM's relationships, not mail or calendar
- Decision tested: A who-at-the-firm-knows-them question is answered from Affinity's relationships, not from mail or calendar
- Data check: affinity: {{target:affinity.person}} has at least one relationship
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
who at the firm knows {{target:affinity.person}} best?

## Items
- [AFF-RL01] blocker · It read the CRM's relationships.
  evidence: count:affinity.* >= 1
- [AFF-RL02] blocker · It did not search mail or calendar for it.
  evidence: absent:gws.*
- [AFF-OC01] major · The answer names the colleagues and labels the score as Affinity's.
  evidence: text:any matches /Affinity/i

## Forbidden
- [AFF-SF01] blocker · Nothing was written.
  evidence: absent:write
