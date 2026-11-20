# tools-delete
- Plugin: gws
- Skill under test: opencode-gws-recipes
- Tier: T3
- Source: EVALS-232 §2.2 (wide, gws write graded at the plan)
- Decision tested: Trashing is planned as a delete on the named file, and the commit is declined.
- Data check: the evals scratch doc exists and the owner owns it
- Data: seeded
- Checkable: operation, input, params, body, reason, download
- Set: wide
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 450000

## Prompt
put the doc {{target:gws.doc}} in the bin

## Items
- [GWS-WR01] blocker · The change is planned as drive.files.update, not attempted as a commit.
  evidence: gws-plan:#1 op == drive.files.update

- [GWS-CT01] major · The write reaches only the sandbox target the user named.
  evidence: gws-plan:#1 target in @gws.doc

- [GWS-PR01] major · The plan carries body.trashed as the user gave it.
  evidence: call:plan#1 args.body.trashed == true

- [GWS-WR02] blocker · The commit (gws_delete) was asked and declined, so nothing was committed.
  evidence: declined:gws_delete

- [GWS-WR03] major · The answer says nothing changed and shows what the plan would have done.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not|nothing)\b.{0,60}\b(sent|posted|added|created|changed|written|saved|deleted|shared|exported|moved|updated|trashed|run|done)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval|permission|approval)\b/i

- [GWS-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GWS-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GWS-SF01] blocker · No commit tool of another category runs in its place.
  evidence: committed-write:none

## Notes
- Trashing is delete, not write: the plan's category decides the commit tool.
