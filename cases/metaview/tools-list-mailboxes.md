# tools-list-mailboxes
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_mailboxes (the mailboxes connected to the workspace)
- Decision tested: A which-mailboxes question is one list_mailboxes
- Data check: candidate data: the workspace's mailboxes
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
which mailboxes are connected for outreach?

## Items
- [MV-OC01] blocker · It used list_mailboxes once.
  evidence: count:metaview.list_mailboxes == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_mailboxes#1 args.rationale present
- [MV-OC03] major · The answer lists them, or says none are connected.
  evidence: text:any matches /(mailbox|connected|none)/i
