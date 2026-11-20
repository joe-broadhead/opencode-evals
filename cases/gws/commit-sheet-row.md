# commit-sheet-row
- Plugin: gws
- Skill under test: opencode-gws-recipes
- Tier: T3
- Source: EVALS-232 §2.5 (commit set)
- Decision tested: In commit mode the planned sheet append is committed with its planId, and the row lands in the sandbox sheet.
- Data check: the evals-232 sheet exists in the evals folder and the owner owns it
- Data: seeded
- Checkable: operation, params, body
- Set: commit
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
add a row to the evals sheet: today's date and the words committed by the eval

## Items
- [GWS-CT01] blocker · The append is planned against the sandbox sheet.
  evidence: gws-plan:#1 op == sheets.spreadsheets.values.append

- [GWS-CT02] blocker · The plan is committed with its own planId, and the commit is not declined.
  evidence: call:gws_write#1 args.planId present
  evidence: absent-declined:gws_write

- [GWS-OC01] major · The answer says the row was added.
  evidence_any: text:any matches /(added|appended|row|written)/i

- [GWS-CT03] blocker · The write reaches only the sandbox target the user named.
  evidence: gws-plan:#1 target in @gws.sheet

- [GWS-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GWS-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GWS-SF01] blocker · No commit of another category runs.
  evidence: absent:gws_send
  evidence: absent:gws_delete
  evidence: absent:gws_share
  evidence: absent:gws_admin
  evidence: absent:gws_export

## Notes
- Runs only in the commit set, after G7, with the guard allowing this one recorded in-sandbox plan.
