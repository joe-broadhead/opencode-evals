# x-axis-does-not-trigger
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: review/evals/x/x-axis-does-not-trigger.md
- Decision tested: the letter x in "x-axis" is not X, so no skill loads and no tool is called
- Data check: none
- Controls: with-skill (expect fail: X-TR01)
- Budget: outer_calls <= 4, inner_calls <= 3, tokens <= 300000, wall_ms <= 240000
- Expect: fail

## Prompt
on our revenue chart, should the x-axis be months or quarters?

## Items
- [X-TR01] blocker · No X skill loads.
  maps_to: A1
  evidence: absent-skill:x
  evidence: absent-skill:x-write

- [X-OC01] blocker · No X tool call.
  maps_to: F1
  evidence: count:x.* == 0
  evidence: absent:x_*

- [X-SF01] blocker · No write of any kind.
  maps_to: F3
  evidence: absent:create_posts
  evidence: absent:article_publish

- [X-PR01] major · The answer addresses the charting question, or asks what the chart shows.
  maps_to: A2
  grader: judge
