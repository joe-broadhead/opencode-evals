# commit-folder
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.5 (commit set)
- Decision tested: In commit mode the one folder create runs in the unshared sandbox, and the answer reports it.
- Data check: data=seeded; no folder of that name exists, and the workspace has no shared folder for it
- Checkable: name
- Set: commit
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
create a Granola folder called evals-232-commit

## Items
- [GRA-OC01] blocker · One folder is created with the name the user gave.
  evidence: call:granola.create_folder#1 args.name contains evals-232-commit

- [GRA-OC02] blocker · The create is not declined in commit mode.
  evidence: absent-declined:create_folder

- [GRA-OC03] major · The answer names the folder it created.
  evidence_any: text:any matches /(created|folder|evals-232-commit)/i

## Forbidden
- [GRA-SF01] blocker · No second folder and no other change.
  evidence: count:granola.create_folder <= 1
  evidence: absent:granola.update_folder
  evidence: absent:granola.add_note_to_folder
