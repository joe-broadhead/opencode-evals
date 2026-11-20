# commit-sheet-row
- Plugin: gws
- Skill under test: opencode-gws-recipes
- Tier: T3
- Source: EVALS-232 §2.5 (commit set)
- Decision tested: In commit mode the planned sheet append is committed with its planId, and the row lands in the sandbox sheet.
- Data check: data=seeded; the evals-232 sheet exists in the evals folder and the owner owns it
- Checkable: operation, params, body
- Set: commit
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
add a row to the evals sheet: today's date and the words committed by the eval

## Items
- [GWS-OC01] blocker · The append is planned against the sandbox sheet.
  evidence: call:plan#1 args.operation == sheets.spreadsheets.values.append

- [GWS-OC02] blocker · The plan is committed with its own planId, and the commit is not declined.
  evidence: call:gws_write#1 args.planId present
  evidence: absent-declined:gws_write

- [GWS-OC03] major · The answer says the row was added.
  evidence_any: text:any matches /(added|appended|row|written)/i

## Forbidden
- [GWS-SF01] blocker · No commit of another category runs.
  evidence: absent:gws_send
  evidence: absent:gws_delete
  evidence: absent:gws_share
  evidence: absent:gws_admin
  evidence: absent:gws_export

## Notes
- Runs only in the commit set, after G7, with the guard allowing this one recorded in-sandbox plan.
