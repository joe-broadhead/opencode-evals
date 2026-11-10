# ho-no-trigger-haiku
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: triggering control
- Decision tested: Held out: a task unrelated to history.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect pass)
- Budget: outer_calls <= 6, inner_calls <= 3, wall_ms <= 180000
- Holdout: true

## Prompt
write a four-line poem about relational databases

## Items
- [H-TR02] major · No history tool was called: the answer is in the code, git or the current conversation.
  evidence: absent:history.*

- [H-TR03] minor · The history-recall skill was not loaded.
  evidence: absent-skill:history-recall

- [H-OC01] blocker · It answered the question.
  evidence: text:any matches /.{20,}/s

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:apply_patch
