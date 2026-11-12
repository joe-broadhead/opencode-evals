# top-three-cost-project
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: topCostApi in truth.json
- Decision tested: A top-N ranking restricted to this project (the default scope).
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
give me the three most expensive sessions in this project, with their cost

## Items
- [H-OC01] blocker · First: Stripe v2 migration at $14.87.
  evidence: text:any matches /14\.87/i

- [H-OC02] blocker · Second: the ECONNRESET investigation at $3.12.
  evidence: text:any matches /3\.12/i
  evidence: text:any matches /ECONNRESET/i

- [H-OC03] blocker · Third: the slow invoices query at $2.05.
  evidence: text:any matches /2\.05/i

- [H-OC04] major · It does not list the lumen-infra incident postmortem ($2.40), which is another project.
  evidence: text:any not-matches /INC-212 postmortem|2\.40/i

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
