# tools-list-meeting-folders-p
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-list-meeting-folders (lane L6b)
- Decision tested: Folders are one folder list, and the answer names the sandbox folder it found.
- Data check: the evals-232 folder exists and is not shared; content is unchecked; only route, arguments and no-write are graded; content unchecked
- Data: real
- Set: wide, twin
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
show me the folders I keep my Granola meetings in

## Items
- [GRA-OC01] blocker · list_meeting_folders answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:list_meeting_folders#1

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:granola
  evidence: committed-write:none
