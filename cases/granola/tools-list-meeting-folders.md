# tools-list-meeting-folders
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: Folders are one folder list, and the answer names the sandbox folder it found.
- Data check: data=seeded; the evals-232 folder exists and is not shared
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
list my Granola folders

## Items
- [GRA-OC01] blocker · list_meeting_folders answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:list_meeting_folders#1

- [GRA-OC02] major · The answer lists the folders, including the sandbox folder.
  evidence_any: text:any matches /(evals-232|folder)/i

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:granola.create_folder
  evidence: absent:granola.update_folder
