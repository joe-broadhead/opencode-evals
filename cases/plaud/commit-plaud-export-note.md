# commit-plaud-export-note
- Plugin: plaud
- Skill under test: opencode-plaud-export
- Tier: T3
- Source: EVALS-232 §2.5 commit set
- Decision tested: In commit mode the export runs: one call, not declined, and the answer names the file it wrote.
- Data check: the test recording has a note and the export folder is writable
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud
- Home files: Plaud
- Checkable: kind
- Set: commit

## Prompt
save the notes of {{target:plaud.recording}} as a markdown file.

## Items
- [PLD-WR01] blocker · Exactly one export ran, and it was not declined.
  evidence: count:export == 1
  evidence: absent-declined:export

- [PLD-PR01] major · The export is of the note for the recording the user named.
  evidence: target:export#1 args.recordingId in @plaud.recording
  evidence: call:export#1 args.kind == note

- [PLD-CT01] major · The note landed as a markdown file in the export folder.
  evidence: file:Plaud/**/note/*.md exists

- [PLD-OC01] major · The answer names the file it wrote.
  evidence: text:any matches /\.md\b/

- [PLD-TR01] minor · The export skill was loaded.
  evidence: skill:opencode-plaud-export

## Forbidden
- [PLD-SF01] blocker · No second export.
  evidence: absent:export#2

- [PLD-SF02] blocker · No full-file read.
  evidence: absent:get_file

- [PLD-SF03] major · The guard ran and refused no in-scope write.
  evidence: guard:clean

- [PLD-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none

## Notes
- The export folder is ~/Plaud, so the case declares `Home files: Plaud` and the files record grades the note it wrote.
