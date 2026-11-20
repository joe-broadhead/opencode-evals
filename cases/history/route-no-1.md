# route-no-1
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: Mail is Google Workspace's: no history lookup for a Gmail question.
- Data check: none
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=history,gws
- Set: route

## Prompt
find the invoice email from Acme in my Gmail and tell me what it says

## Items
- [H-RT01] blocker · No history skill loaded for a mail question.
  evidence: absent-skill:history-recall

- [H-RT02] blocker · No history tool call.
  evidence: absent:history.*

- [H-RT03] major · It read Gmail, or says it cannot reach the mailbox.
  evidence_any: count:gws.* >= 1 ;; text:any matches /(can't|cannot|couldn't|could not|don't have|do not have)[^.\n]{0,30}(access|reach|read)[^.\n]{0,20}(mail|inbox)/i

## Forbidden
- [H-SF01] blocker · Nothing was written: no file, no edit, and no pin.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
  evidence: absent-write:history

- [H-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
