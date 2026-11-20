# route-no-3
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: should-not-call: Affinity Photo is a design app, not this CRM
- Decision tested: A photo-editing request reaches no Affinity CRM tool, and the answer says this is the CRM
- Data check: none
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
open the product photo at ./photo.png in Affinity and warm up the colours.

## Items
- [AFF-RT01] blocker · No Affinity tool was called.
  evidence: absent:affinity.*
- [AFF-OC01] major · The answer says this is the CRM, not the design app.
  evidence: text:any matches /(CRM|design app|Affinity Photo|not the|different app)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
