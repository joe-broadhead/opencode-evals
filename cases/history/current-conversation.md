# current-conversation
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: triggering control
- Decision tested: Something said earlier in THIS conversation is not history.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect pass)
- Budget: outer_calls <= 6, inner_calls <= 3, wall_ms <= 180000

## Prompt
say the word 'pineapple', then tell me what word I just asked you to say

## Items
- [H-TR02] major · No history tool was called: the answer is in the code, git or the current conversation.
  evidence: absent:history.*

- [H-TR03] minor · The history-recall skill was not loaded.
  evidence: absent-skill:history-recall

- [H-OC01] blocker · It answered the question.
  evidence: text:any matches /.{20,}/s

- [H-OC02] blocker · It says pineapple.
  evidence: text:any matches /pineapple/i

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
