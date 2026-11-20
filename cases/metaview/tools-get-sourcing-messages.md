# tools-get-sourcing-messages
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_sourcing_messages (the messages in a sourcing search)
- Decision tested: A what-did-we-send question is one message read for the search
- Data check: candidate data: {{target:metaview.search}} has sent messages
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
what did we actually send in the backend sourcing search? show me the messages.

## Items
- [MV-OC01] blocker · It used get_sourcing_messages once.
  evidence: count:metaview.get_sourcing_messages == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_sourcing_messages#1 args.rationale present
- [MV-PR02] major · It read the search it resolved.
  evidence: call:metaview.get_sourcing_messages#1 args.search_id present
- [MV-OC04] major · The answer shows the message text or says none were sent.
  evidence: text:any matches /(message|sent|no messages)/i
