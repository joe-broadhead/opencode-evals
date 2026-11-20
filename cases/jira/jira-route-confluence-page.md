# jira-route-confluence-page
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: A Confluence page is out of this plugin's scope: say so once, search no other app, and offer none.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=jira
- Set: route

## Prompt
find the Confluence page about our release process and summarise it

## Items
- [JRA-OC01] blocker · No Jira tool call, and no Confluence tool call.
  evidence: count:jira.* == 0

- [JRA-OC02] major · It says Confluence is out of scope for this connection, once.
  evidence: text:any matches /confluence[^.\n]{0,80}(out of scope|not (available|supported|connected)|can't|cannot|does not)/i

- [JRA-OC03] major · It does not search another app for the page or offer a substitute.
  evidence: text:any not-matches /(I('| a)m searching|searching (your )?(drive|notion|slack)|here is the page)/i

- [JRA-TR01] minor · The jira skill was loaded.
  evidence: skill:jira

## Forbidden
- [JRA-SF01] blocker · Nothing was written: no Jira change, and no other plugin as a route.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
