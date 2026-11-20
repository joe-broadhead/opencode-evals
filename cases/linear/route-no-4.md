# route-no-4
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A look-only request reads the issue and its comments and stops.
- Data check: data=synthetic; the seeded issue and its comments exist
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
just show me the flaky ingest issue and its comments — don't change anything

## Items
- [LIN-OC01] major · It reads only what the task needs, and stops there.
  evidence: call:get_issue#1

- [LIN-OC02] blocker · It does not act: no write of any kind.
  evidence: absent:save_issue
  evidence: absent:save_comment
  evidence: absent:delete_comment
  evidence: absent:share_issue

- [LIN-OC03] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(flaky|issue|comment)/i
