# tools-group-conversations
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: group_conversations (counts by group, never fetched rows)
- Decision tested: A how-many-by question is one grouped count, not a fetch of every row
- Data check: candidate data: at least ten conversations in the last month
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
how many interviews did each interviewer run last month? counts only.

## Items
- [MV-OC01] blocker · It used group_conversations once.
  evidence: count:metaview.group_conversations == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.group_conversations#1 args.rationale present
- [MV-PR02] major · It grouped by interviewer.
  evidence: call:metaview.group_conversations#1 args.group_by matches /interviewer/i
- [MV-OC04] major · The answer gives a count per interviewer, and names the month.
  evidence: text:any matches /(\b[0-9]+\b).{0,80}(interviewer|interview)|interviewer.{0,80}\b[0-9]+\b/is
