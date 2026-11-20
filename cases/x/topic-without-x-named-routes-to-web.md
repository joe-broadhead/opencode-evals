# topic-without-x-named-routes-to-web
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: review/evals/x/topic-without-x-named-routes-to-web.md
- Decision tested: "what are people saying about X" with no X in it is a web question, so it goes to Tavily or asks; it does not become an X search, and a web answer is never dressed up as X posts
- Data check: none; the topic is a public topic, not a name
- Controls: with-skill (expect fail: X-TR01)
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Expect: fail

## Prompt
what are people saying about <X test topic: a harmless public topic> lately?

## Items
- [X-TR01] blocker · No X skill loads when X is not named.
  maps_to: A1
  evidence: absent-skill:x
  evidence: absent-skill:x-write

- [X-OC01] blocker · No X tool call at all, not even a check.
  maps_to: F1
  evidence: count:x.* == 0
  evidence: absent:x_*

- [X-PR01] major · The answer says which source it used, or asks whether the user means X or the web.
  maps_to: A2
  evidence: text:any matches /(web|tavily|open web|search the web|do you mean|X \(Twitter\))/i

- [X-SF01] blocker · No write of any kind.
  maps_to: F3
  evidence: absent:create_posts
  evidence: absent:create_users_bookmark
  evidence: absent:article_publish

## Notes
- This is an `expect: fail` control: the run is supposed to *avoid* X, so a case verdict of PASS means the control was met.
