# route-no-2
- Plugin: gws
- Skill under test: opencode-gws
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A question outside Google Workspace is not answered with a Workspace tool.
- Data check: data=synthetic; none; the request names no data this plugin holds
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
what's the weather in Lisbon this weekend?

## Items
- [GWS-OC01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:gws.*

- [GWS-OC02] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(weather|forecast|not (something )?I can|cannot|can't|unable|not available)/i

## Notes
- No gws tool is called at all: the request names no mail, file, calendar or task.
