# list-all-14d-pagination
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: truth (lumen-api, created in the last 14 days): 40 top-level unarchived, 42 with archived, 44 with subagents, 46 with both; fillers avoid the 13.4-14.6 day band, so the count does not move with the build hour
- Decision tested: F5 pagination. history_sessions returns 20 rows by default; a complete list needs `next` as `cursor`, a larger limit, or one sql count. "Tax region" (13 days old) is on the second page by recency.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 300000
- Set: core, new
- Truth: sql.list14dApi.top == 40; sql.list14dApi.withArchived == 42; sql.list14dApi.withSubagents == 44; sql.list14dApi.all == 46

## Prompt
list every session I've had in this project over the last 14 days, the complete list, not just the first page, and tell me how many there are

## Items
- [H-OC01] blocker · It gives the total: 40 (or 42 with archived, 44 with subagents, 46 with both).
  evidence: text:any matches /\b(40|42|44|46)\b (sessions|in total|total)|total[^.\n]{0,25}\b(40|42|44|46)\b|\b(40|42|44|46)\b[^.\n]{0,15}sessions/i

- [H-OC02] major · The list reaches past the first page: it includes the 13-day-old tax_region migration.
  evidence: text:any matches /tax[_ ]region/i

- [H-PR05] major · It went past the first page: a second sessions call with cursor, a limit of 40 or more, or one sql statement.
  evidence_any: call:history.sessions#2 args.cursor present ;; call:history.sessions#3 args.cursor present ;; call:history.sessions#1 args.limit >= 40 ;; call:history.sessions#2 args.limit >= 40 ;; call:history.sql#1

- [H-PR06] minor · The list names the sessions by ID (a sessions list has no seq), at least 30 of them.
  evidence: text:any count /ses_[A-Za-z0-9]{22}/ >= 30

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing.
  evidence: absent:history_pin

## Notes
- Truth is derived from the world (lab/gold, read-only): created >= now - 14 days in lumen-api, by parent and archived. Regenerate it with the world (W1-W3 add no session inside 14 days).
- Families: F5 (pagination, hidden results). World: unchanged.
