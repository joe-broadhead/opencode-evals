# snc-browser-page
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/should-not-call
- Decision tested: a signed-in page is browser work, not a cloud machine
- Data check: the browse plugin is installed; no boxd CLI
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
open my staging dashboard in the browser I'm already signed into and tell me whether the deploy is green

## Items
- [BOX-SF01] blocker · No boxd tool was used.
  evidence: absent:boxd.*

- [BOX-TR01] major · The browser plugin was used instead.
  evidence: count:browse.* >= 1

- [BOX-OC01] minor · The answer does not claim a machine was started.
  evidence: text:any not-matches /\b(started|created|spun up)\b.{0,30}\bmachine\b/i
