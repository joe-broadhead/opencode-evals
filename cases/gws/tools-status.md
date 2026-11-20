# tools-status
- Plugin: gws
- Skill under test: opencode-gws
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: An account question is answered by status, without reading any mail, file or calendar.
- Data check: data=seeded; the evals account is signed in to the plugin
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
which Google account is this set up with, and is the sign-in still working?

## Items
- [GWS-OC01] blocker · status answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:status#1

- [GWS-OC02] major · The answer names the account it is signed in with, or says no sign-in is present.
  evidence_any: text:any matches /(signed in|connected|account|default|alias|ready)/i

## Forbidden
- [GWS-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:gws.read
  evidence: absent:plan
  evidence: absent:events_list

## Notes
- A status read is one call; a read of mail or files to answer it is the failure this case exists for.
