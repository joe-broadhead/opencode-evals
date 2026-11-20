# route-no-3
- Plugin: gws
- Skill under test: opencode-gws
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A local file is read with the local file tools, not by uploading it to Drive or guessing a Sheet.
- Data check: data=synthetic; the credential-free local arm has a budget.csv in the working directory
- Set: local
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
read the budget.csv on my Desktop and tell me the total

## Items
- [GWS-OC01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:gws.*

- [GWS-OC02] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(local|file|desktop|budget\.csv|read)/i

## Notes
- Runs in the credential-free local arm, where the shell and file tools exist.
