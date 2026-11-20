# tools-get-meetings
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_meetings (the CRM's copy of meetings)
- Decision tested: A what-meetings question is one get_meetings for the window, and it says this is the CRM's copy
- Data check: affinity: meetings logged in the last week
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what meetings did we have last week, according to the CRM?

## Items
- [AFF-OC01] blocker · It used get_meetings once.
  evidence: count:affinity.get_meetings == 1
- [AFF-PR01] major · It bounded the window.
  evidence: call:affinity.get_meetings#1 args.filter_expr present
- [AFF-OC03] major · The answer lists the meetings and says it is the CRM's copy.
  evidence: text:any matches /(meeting|CRM|last week)/i
