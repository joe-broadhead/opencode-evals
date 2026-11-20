# tools-search-files
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: search_files (files by prompt, optionally one company)
- Decision tested: A find-the-deck question is one search_files
- Data check: affinity: a deck about {{target:affinity.company}} exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
find the deck we have about {{target:affinity.company}}'s round.

## Items
- [AFF-OC01] blocker · It used search_files once.
  evidence: count:affinity.search_files == 1
- [AFF-PR01] major · It searched for the deck.
  evidence: call:affinity.search_files#1 args.prompt present
- [AFF-OC03] major · The answer names the file, or says none matched.
  evidence: text:any matches /(deck|file|found|no files)/i
