# tools-list-folder-meetings-p
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-list-folder-meetings (lane L6b)
- Decision tested: A folder's meetings come from list_folders then list_folder_meetings with that folder's id.
- Data check: a Wispr Flow folder named for the round exists with one meeting
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide, twin

## Prompt
which meetings are filed in my evals-232 folder?

## Items
- [WF-OC01] blocker · The folder was found and its meetings listed.
  evidence: count:list_folders >= 1
  evidence: count:list_folder_meetings == 1

- [WF-PR01] major · The listing passed that folder's id.
  evidence: call:list_folder_meetings#1 args.folder_id present

- [WF-CT01] major · The meetings are cited by their share links.
  evidence: text:any matches /notes\.wisprflow\.ai/

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
