# git-latest-commit
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: triggering control
- Decision tested: A pure git question: 'what is the latest commit' is git's job, not the session history's.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect pass)
- Budget: outer_calls <= 6, inner_calls <= 3, wall_ms <= 180000

## Prompt
what's the latest commit message in this repo?

## Items
- [H-TR02] major · No history tool was called: the answer is in the code, git or the current conversation.
  evidence: absent:history.*

- [H-TR03] minor · The history-recall skill was not loaded.
  evidence: absent-skill:history-recall

- [H-OC01] blocker · It answered the question.
  evidence: text:any matches /.{20,}/s

- [H-OC02] blocker · It reports the latest commit message from git: 'fix: handle null category'.
  evidence: text:any matches /handle null category/i

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:apply_patch
