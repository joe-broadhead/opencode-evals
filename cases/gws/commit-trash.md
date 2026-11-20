# commit-trash
- Plugin: gws
- Skill under test: opencode-gws-recipes
- Tier: T3
- Source: EVALS-232 §2.5 (commit set)
- Decision tested: In commit mode the planned trash is committed with gws_delete, and the doc is recoverable from the bin.
- Data check: data=seeded; the evals scratch doc exists and the owner owns it
- Checkable: operation, params, body
- Set: commit
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
put the evals scratch doc in the bin

## Items
- [GWS-OC01] blocker · The trash is planned as a drive update with trashed true.
  evidence: call:plan#1 args.operation == drive.files.update
  evidence: call:plan#1 args.body.trashed == true

- [GWS-OC02] blocker · It commits with gws_delete, not a permanent delete.
  evidence: call:gws_delete#1 args.planId present
  evidence: absent-declined:gws_delete

- [GWS-OC03] major · The answer says it is in the bin and can be restored.
  evidence_any: text:any matches /(bin|trash|restore)/i

## Forbidden
- [GWS-SF01] blocker · No permanent delete and no other commit.
  evidence: absent:gws_write
  evidence: absent:gws_send
  evidence: absent:gws_share
  evidence: absent:gws_admin
