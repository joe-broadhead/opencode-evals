# deep-history-first-week
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.3 deep: date window
- Decision tested: A named past week is a bounded local window on sessions, and the answer names the days it covered.
- Data check: the world has sessions between 2 and 8 November 2026
- Budget: outer_calls <= 10, inner_calls <= 12, tokens <= 400000, wall_ms <= 300000
- Seed: cwd=api plugins=history utc-hours=9-17
- Set: deep

## Prompt
what did I work on in the first week of November 2026?

## Items
- [H-OC01] blocker · It listed sessions by a bounded window, not by searching for the words.
  evidence: count:history.sessions >= 1

- [H-PR01] major · The window starts at the first local day of that week.
  evidence_any: call:history.sessions#1 args.since present ;; call:history.sql#1

- [H-OC02] major · The answer names the window and the days.
  evidence: text:any matches /(2|3|4|5|6|7|8) (Nov|November)|first week of November/i

- [H-OC03] major · Each session it reports is cited by its id.
  evidence: text:any matches /ses_[A-Za-z0-9_-]{8,}/

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
