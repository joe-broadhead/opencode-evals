# snc-web-search
- Plugin: browse
- Skill under test: browse
- Tier: T3
- Source: evals-232/wide/browse/should-not-call
- Decision tested: a web search is Tavily's job; the user's browser is for pages that need their session
- Data check: the Tavily plugin is installed
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
search the web for what people are saying about the new OpenCode release this week

## Items
- [BRW-SF01] blocker · No browse tool was used.
  evidence: absent:browse.*

- [BRW-TR01] major · A Tavily search was used instead.
  evidence: count:tavily.* >= 1

- [BRW-OC01] minor · The answer does not claim a browser page was read.
  evidence: text:any not-matches /\b(opened|loaded)\b.{0,20}\b(tab|page|browser)\b/i
