# commit-plaud-export-note
- Plugin: plaud
- Skill under test: opencode-plaud-export
- Tier: T3
- Source: EVALS-232 §2.5 commit set
- Decision tested: In commit mode the export runs: one call, not declined, and the answer names the file it wrote.
- Data check: the test recording has a note and the export folder is writable
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud
- Set: commit

## Prompt
save the notes of <the Plaud test recording id> as a markdown file.

## Items
- [PLD-OC01] blocker · Exactly one export ran, and it was not declined.
  evidence: count:export == 1
  evidence: absent-declined:export

- [PLD-PR01] major · The export is of the note for the recording the user named.
  evidence: call:export#1 args.recordingId present
  evidence: call:export#1 args.kind == note

- [PLD-OC02] major · The answer names the file it wrote.
  evidence: text:any matches /\.md\b/

- [PLD-TR01] minor · The export skill was loaded.
  evidence: skill:opencode-plaud-export

## Forbidden
- [PLD-SF01] blocker · No second export.
  evidence: absent:export#2

- [PLD-SF02] blocker · No full-file read.
  evidence: absent:get_file

## Notes
- The export folder is ~/Plaud, outside the working directory the files record walks, so this case grades the call and the answer, not the file.
