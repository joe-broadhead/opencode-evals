# tools-list-folder-meetings
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A folder's meetings come from list_folders then list_folder_meetings with that folder's id.
- Data check: synthetic: a Wispr Flow folder named for the round exists with one meeting
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
list the meetings in my <the evals-232 Wispr Flow folder> folder.

## Items
- [WF-OC01] blocker · The folder was found and its meetings listed.
  evidence: count:list_folders >= 1
  evidence: count:list_folder_meetings == 1

- [WF-OC02] major · The listing passed that folder's id.
  evidence: call:list_folder_meetings#1 args.folder_id present

- [WF-OC03] major · The answer names the folder and its meetings.
  evidence: text:any matches /(folder|meeting)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
