# last-24h-not-events-list
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: today-1 "Triage Sentry alert for 500s on /v1/catalog" (2.5 h before the corpus was built)
- Decision tested: F11 precision. events_list is "for Memory's collector and scripts, not for answering questions"; a recent-work question is sessions with since.
- Seed: cwd=api time=day
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 8, wall_ms <= 240000
- Set: core, new

## Prompt
what have I worked on in the last 24 hours?

## Items
- [H-OC01] major · It lists the Sentry triage of the /v1/catalog 500s.
  evidence: text:any matches /sentry/i

- [H-PR05] major · It did not use events_list to answer a question.
  evidence: absent:history.events_list

- [H-PR06] major · It used a time-bounded listing: sessions with since, or sql.
  evidence_any: call:history.sessions#1 args.since present ;; call:history.sessions#2 args.since present ;; call:history.sql#1

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
- today-1 is in the last 24 hours whenever the run is within about 21 hours of the build; time=day keeps it on the corpus day.
- Families: F11 (tool choice in the catalog), F4 (time window). World: unchanged.
