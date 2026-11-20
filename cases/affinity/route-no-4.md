# route-no-4
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: should-not-call: issue tracking is Linear's, not the CRM's
- Decision tested: A how-many-open-issues question reaches no Affinity tool
- Data check: the user's Linear workspace has open issues
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
how many open issues do we have in Linear right now?

## Items
- [AFF-RL01] blocker · No Affinity tool was called.
  evidence: absent:affinity.*
- [AFF-OC01] major · The answer answers about the issue tracker.
  evidence: text:any matches /(Linear|issue|open|tracker)/i
