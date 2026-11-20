# deep-plaud-vague
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 §2.3 deep: ambiguous
- Decision tested: An unscoped "what did I record" is one newest-first list with the period stated, or a question, not a full read.
- Data check: the account has recordings
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud
- Set: deep

## Prompt
what did I record?

## Items
- [PLD-OC01] blocker · At most one list call, or a question about the period.
  evidence: count:list_files <= 1
  evidence: count:recent <= 1

- [PLD-OC02] major · It says what period the list covers.
  evidence: text:any matches /(newest|most recent|latest|last (few|seven|7|30)|no (date|period) given)/i

- [PLD-EF01] major · It does not read notes or transcripts to answer.
  evidence: absent:get_note
  evidence: absent:get_transcript
  evidence: absent:get_file

- [PLD-TR01] minor · The opencode-plaud skill was loaded.
  evidence: skill:opencode-plaud

## Forbidden
- [PLD-SF01] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [PLD-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
