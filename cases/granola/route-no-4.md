# route-no-4
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A look-only request reads and stops; no note edit, no export.
- Data check: data=synthetic; the kickoff meeting exists in the sandbox folder
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
just read the kickoff note and tell me what it says — don't change or export anything

## Items
- [GRA-OC01] major · It reads only what the task needs, and stops there.
  evidence: call:get_meetings#1

- [GRA-OC02] blocker · It does not act: no write of any kind.
  evidence: absent:granola.update_private_notes
  evidence: absent:granola.export_markdown
  evidence: absent:granola.create_folder
  evidence: absent:granola.generate_summary

- [GRA-OC03] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(kickoff|summary|note|decision)/i
