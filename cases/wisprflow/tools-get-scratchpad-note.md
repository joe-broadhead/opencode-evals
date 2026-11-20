# tools-get-scratchpad-note
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: One Scratchpad note's text comes from get_scratchpad_note by its id.
- Data check: a Scratchpad note named for the round exists
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
find my Wispr Flow Scratchpad note about the evals round and give me its main points.

## Items
- [WF-OC01] blocker · The note was found and read once.
  evidence: count:get_scratchpad_note == 1

- [WF-PR01] major · The note id the user gave was passed.
  evidence: call:get_scratchpad_note#1 args.note_id present

- [WF-OC02] major · The answer gives the note's points.
  evidence: text:any matches /(^|\n)\s*[-*]\s+\S/

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
