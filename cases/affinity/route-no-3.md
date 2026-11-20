# route-no-3
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: should-not-call: Affinity Photo is a design app, not this CRM
- Decision tested: A photo-editing request reaches no Affinity CRM tool, and the answer says this is the CRM
- Data check: none
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
open the product photo in Affinity and warm up the colours.

## Items
- [AFF-RL01] blocker · No Affinity tool was called.
  evidence: absent:affinity.*
- [AFF-OC01] major · The answer says this is the CRM, not the design app.
  evidence: text:any matches /(CRM|design app|Affinity Photo|not the|different app)/i
