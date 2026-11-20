# tools-search-snippets
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: search_snippets (the moments in one conversation that answer a prompt)
- Decision tested: A where-did-they-say-it question is one search_snippets on the conversation, with timed ranges
- Data check: the most recent interview has a transcript
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
where did the most recent candidate explain why they want to leave their current job? give me the moments.

## Items
- [MV-TR01] blocker · It used search_snippets once.
  evidence: call:metaview.search_snippets#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.search_snippets#1 args.rationale present
- [MV-PR02] major · It searched for the reason they gave.
  evidence: call:metaview.search_snippets#1 args.prompt present
- [MV-OC01] major · The answer gives timed ranges, not a paraphrase of the whole call.
  evidence: text:any matches /[0-9]+:[0-9]{2}\s*-\s*[0-9]+:[0-9]{2}/
- [MV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
