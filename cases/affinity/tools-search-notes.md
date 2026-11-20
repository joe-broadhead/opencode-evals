# tools-search-notes
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: search_notes (notes by topic, for one company or across records)
- Decision tested: A what-do-our-notes-say-about-pricing question is one search_notes
- Data check: notes mentioning pricing exist
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what do our notes say about pricing across the portfolio?

## Items
- [AFF-TR01] blocker · It used search_notes once.
  evidence: call:affinity.search_notes#1
- [AFF-PR01] major · It searched for pricing.
  evidence: call:affinity.search_notes#1 args.prompt present
- [AFF-OC01] major · The answer reports what the notes say, in its own words.
  evidence: text:any matches /(pricing|note|said)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
