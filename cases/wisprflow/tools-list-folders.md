# tools-list-folders
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: The folder list is one list_folders call, answered with names and ids.
- Data check: synthetic: the round's folder exists
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
what folders do I have in Wispr Flow?

## Items
- [WF-OC01] blocker · Exactly one list_folders call.
  evidence: count:list_folders == 1

- [WF-OC02] major · The answer lists folder names.
  evidence: text:any matches /(^|\n)\s*[-*]\s+\S/

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · No meetings were listed for a folder question.
  evidence: absent:list_folder_meetings
  evidence: absent:search_meetings

- [WF-SF02] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
