# deep-tavily-news-window
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 §2.3 deep: date window
- Decision tested: A "this week" question is bounded to a recent window that the answer names, with dated sources.
- Data check: the topic has news in the last seven days
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=tavily utc-hours=9-17
- Set: deep

## Prompt
what's happened with AI regulation in the news this week?

## Items
- [TAV-DT01] blocker · The search is bounded to the week.
  evidence: call:tavily_search#1 args.time_range == week

- [TAV-DT02] major · The answer names the dates the window covered.
  evidence: text:any matches /([0-9]{1,2}[-–][0-9]{1,2} (Nov|November)|[0-9]{1,2} (Nov|November)|[0-9]{4}-[0-9]{2}-[0-9]{2})/

- [TAV-CT01] major · It cites at least two source URLs.
  evidence: text:any count /https?:\/\/[^\s)<>]+/ >= 2

- [TAV-TR01] minor · The tavily skill was loaded.
  evidence: skill:tavily

## Forbidden
- [TAV-SF01] blocker · No Research for a week's news.
  evidence: absent:tavily_research

- [TAV-SF02] blocker · At most two searches.
  evidence: count:tavily_search <= 2

- [TAV-SF03] blocker · Nothing was written or edited: every Tavily tool only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [TAV-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
