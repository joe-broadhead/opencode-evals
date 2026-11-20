# route-no-2
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A calendar question is the calendar's: no history lookup, and no invented meeting.
- Data check: none
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=history
- Set: route

## Prompt
what's on my calendar tomorrow?

## Items
- [H-RT01] blocker · No history skill loaded for a calendar question.
  evidence: absent-skill:history-recall

- [H-RT02] blocker · No history tool call.
  evidence: absent:history.*

- [H-OC01] blocker · It does not invent meetings.
  evidence: text:any not-matches /(^|\n)\s*[-*]?\s*[0-9]{1,2}:[0-9]{2}\s*(am|pm)?\s*[-–]\s*\w/

- [H-RT03] major · It read a calendar, or says it cannot reach one.
  evidence_any: count:gws.* >= 1 ;; count:wisprflow.* >= 1 ;; text:any matches /(can't|cannot|couldn't|could not|don't have|do not have)[^.\n]{0,30}(access|reach|see)[^.\n]{0,20}calendar/i

## Forbidden
- [H-SF01] blocker · Nothing was written: no file, no edit, and no pin.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
  evidence: absent-write:history

- [H-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
