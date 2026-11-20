# hist-no-calendar
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A calendar question is the calendar's: no history lookup, and no invented meeting.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=history,gws,wisprflow
- Set: route

## Prompt
what's on my calendar tomorrow?

## Items
- [H-TR01] blocker · No history skill loaded for a calendar question.
  evidence: absent-skill:history-recall

- [H-OC01] blocker · No history tool call.
  evidence: count:history.* == 0

- [H-OC02] blocker · It does not invent meetings.
  evidence: text:any not-matches /(^|\n)\s*[-*]?\s*[0-9]{1,2}:[0-9]{2}\s*(am|pm)?\s*[-–]\s*\w/

- [H-OC03] major · It names the calendar it would check, or says it cannot reach it.
  evidence_any: text:any matches /(calendar|google calendar|wispr ?flow)/i ;; text:any matches /(can't|cannot|couldn't|could not|don't have|do not have)[^.\n]{0,30}(access|reach|see)[^.\n]{0,20}calendar/i

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
