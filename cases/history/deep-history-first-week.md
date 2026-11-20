# deep-history-first-week
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.3 deep: date window
- Decision tested: A named past week is a bounded local window on sessions, and the answer names the days it covered.
- Data check: the world has sessions between 2 and 8 November 2026
- Data: own
- Budget: outer_calls <= 10, inner_calls <= 12, tokens <= 400000, wall_ms <= 300000
- Seed: cwd=api plugins=history utc-hours=9-17
- Checkable: since
- Set: deep

## Prompt
what did I work on in the first week of November 2026?

## Items
- [H-DT01] blocker · It listed sessions by a bounded window, not by searching for the words.
  evidence: count:history.sessions >= 1

- [H-PR01] major · The window starts at the first local day of that week.
  evidence_any: call:history.sessions#1 args.since matches /2026-11-0[12]/ ;; call:history.sql#1

- [H-DT02] major · The answer names the dates the window covered.
  evidence: text:any matches /([0-9]{1,2}[-–][0-9]{1,2} (Nov|November)|[0-9]{1,2} (Nov|November)|[0-9]{4}-[0-9]{2}-[0-9]{2})/

- [H-CT01] major · Each session it reports is cited by its id.
  evidence: text:any matches /ses_[A-Za-z0-9_-]{8,}/

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

## Forbidden
- [H-SF01] blocker · Nothing was written: no file, no edit, and no pin.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
  evidence: absent-write:history

- [H-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
