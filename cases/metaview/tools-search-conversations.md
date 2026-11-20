# tools-search-conversations
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: search_conversations (conversations by filters, with id, url and has_transcript)
- Decision tested: A what-did-we-record question is one filtered search with local-day bounds, and the answer names the window
- Data check: candidate data: at least two recorded conversations in the last week
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
what interviews did we record last week? just the list, with dates.

## Items
- [MV-OC01] blocker · It used search_conversations once.
  evidence: count:metaview.search_conversations == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.search_conversations#1 args.rationale present
- [MV-PR02] major · It filtered by the start time, as a dict with a scope.
  evidence: call:metaview.search_conversations#1 args.filters present
- [MV-PR03] major · It asked for the transcript flag, not whole transcripts.
  evidence: call:metaview.search_conversations#1 args.fields present
- [MV-OC05] major · The answer names the window and cites each conversation by date.
  evidence: text:any matches /(last week|2026-|interview|no conversations)/i
