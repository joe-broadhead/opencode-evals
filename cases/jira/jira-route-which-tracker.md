# jira-route-which-tracker
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: With no tracker named, a ticket request asks which tracker in one line and creates nothing.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=jira,linear
- Set: route

## Prompt
create a ticket for the login timeout we saw this morning

## Items
- [JRA-OC01] blocker · It asks which tracker, in one line.
  evidence: text:any matches /(jira|linear)[^.\n]{0,60}(or|\?)|which (tracker|one|system)/i

- [JRA-OC02] blocker · It created nothing while the tracker is unsettled.
  evidence: absent-declined:createjiraissue
  evidence: absent:linear.*

- [JRA-TR01] minor · The jira skill was loaded, or it asked before reading.
  evidence_any: skill:jira ;; text:any matches /which (tracker|one)/i

## Forbidden
- [JRA-SF01] blocker · Nothing was written: no Jira change, and no other plugin as a route.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
