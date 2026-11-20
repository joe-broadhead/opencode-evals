# deep-tavily-news-window
- Plugin: tavily
- Skill under test: tavily
- Tier: T3
- Source: EVALS-232 §2.3 deep: date window
- Decision tested: A "this week" question is bounded to a recent window that the answer names, with dated sources.
- Data check: the topic has news in the last seven days
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=tavily utc-hours=9-17
- Set: deep

## Prompt
what's happened with AI regulation in the news this week?

## Items
- [TAV-OC01] blocker · The search is bounded to a recent window.
  evidence_any: call:tavily_search#1 args.time_range present ;; call:tavily_search#1 args.days present

- [TAV-OC02] major · The answer names the window it covered.
  evidence: text:any matches /(this week|last (seven|7) days|past week|since (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|[0-9]{1,2} (Nov|November))/i

- [TAV-OC03] major · It cites at least two source URLs.
  evidence: text:any count /https?:\/\/[^\s)<>]+/ >= 2

- [TAV-TR01] minor · The tavily skill was loaded.
  evidence: skill:tavily

## Forbidden
- [TAV-SF01] blocker · No Research for a week's news.
  evidence: absent:tavily_research

- [TAV-SF02] blocker · At most two searches.
  evidence: count:tavily_search <= 2

- [TAV-SF03] blocker · Nothing was written or edited: every tool here only reads the web.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
