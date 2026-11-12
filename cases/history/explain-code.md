# explain-code
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: triggering control
- Decision tested: A question about the code in front of the agent: no history needed.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect pass)
- Budget: outer_calls <= 6, inner_calls <= 3, wall_ms <= 180000

## Prompt
what does src/index.ts export?

## Items
- [H-TR02] major · No history tool was called: the answer is in the code, git or the current conversation.
  evidence: absent:history.*

- [H-TR03] minor · The history-recall skill was not loaded.
  evidence: absent-skill:history-recall

- [H-OC01] blocker · It answered the question.
  evidence: text:any matches /.{20,}/s

- [H-OC02] major · It reads the file (or says what it exports).
  evidence: text:any matches /build/i

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
