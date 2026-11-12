# tokyo-yesterday
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: yesterday-1..4 (lumen-api, UTC day D-1 at 08:10, 10:30, 13:20 and 15:45). Tokyo's yesterday is [D-2 15:00Z, D-1 15:00Z) while the run's UTC hour is below 15, so the first three are in it and the 15:45Z worker investigation is not.
- Decision tested: A local day needs since/until with the user's UTC offset (the skill's Time rule); a bare UTC date lists the wrong sessions.
- Seed: cwd=api time=day utc-hours=1-14
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 300000
- Set: core, new, screen

## Prompt
I'm in Tokyo (UTC+9). which sessions did I work on yesterday, my time, in this project?

## Items
- [H-OC01] major · It lists the request-id work (08:10Z, 17:10 in Tokyo).
  evidence: text:any matches /request[- ]?id/i

- [H-OC02] major · It lists the webhook retry tests (10:30Z).
  evidence: text:any matches /webhook/i

- [H-OC03] major · It lists the jest upgrade (13:20Z).
  evidence: text:any matches /jest/i

- [H-OC04] major · It does not list the worker memory investigation: 15:45Z is 00:45 the next day in Tokyo.
  evidence: text:any not-matches /memory (growth|leak)|leak\w* listeners|worker (memory|leak)/i

- [H-PR05] minor · The window was given in Tokyo time: a since with a +09:00 offset, or the same instant in UTC (15:00Z), or sql.
  evidence_any: call:history.sessions#1 args.since matches /\+9:?9$/ ;; call:history.sessions#1 args.since matches /T15:00:00(\.0+)?Z$/ ;; call:history.sessions#2 args.since matches /\+9:?9$/ ;; call:history.sessions#2 args.since matches /T15:00:00(\.0+)?Z$/ ;; call:history.sql#1

- [H-PR06] minor · It names the sessions by ID.
  evidence: text:any matches /ses_[A-Za-z0-9]{22}/

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing.
  evidence: absent:history_pin

## Notes
- The truth flips at 15:00 UTC (Tokyo's date changes), so the runner must run this case between 01:00 and 14:59 UTC on the corpus day (harness gap HG-6: the lab runner honours time=day only). The extra seed key is ignored by today's runner.
- H-PR05: a trace keeps an ISO date-time with seconds and Z as a value; any other date string is kept as a shape, where +09:00 becomes "+9:9".
- H-OC04 can false-fail an answer that names the worker session only to exclude it; read the Notes before counting such a failure.
- Families: F4 (time window), F5 (filters). World: unchanged.
