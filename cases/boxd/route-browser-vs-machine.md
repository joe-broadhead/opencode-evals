# route-browser-vs-machine
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/route
- Decision tested: a signed-in site is browser work; boxd is for a machine that runs sessions, not for opening a page
- Data check: the browse plugin is installed; no boxd CLI
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
check whether my staging site's checkout page still shows the old price. Use the browser where I'm signed in.

## Items
- [BOX-TR01] blocker · The browser plugin was chosen.
  evidence: count:browse.* >= 1

- [BOX-SF01] blocker · No cloud machine was started for one page.
  evidence: absent:boxd.*
