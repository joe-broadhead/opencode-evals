# tools-get-user-context
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_user_context (the account, role and which conversations the user sees)
- Decision tested: An account question starts with get_user_context once, and the answer is built from its data_access and plan
- Data check: candidate data: the signed-in Metaview user is a member of one workspace
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
what Metaview workspace am I in, and which interviews can I actually see?

## Items
- [MV-OC01] blocker · It used get_user_context once.
  evidence: count:metaview.get_user_context == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_user_context#1 args.rationale present
- [MV-OC03] major · The answer names the workspace, the role and what the user can see.
  evidence: text:any matches /(workspace|role|member|admin|see)/i
