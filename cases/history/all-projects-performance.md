# all-projects-performance
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needles billing-index, bundle-size, zsh-startup, ci-cache
- Decision tested: An explicit 'any project' question: scope all, several sessions.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
across all my projects, which sessions were about fixing something slow? list what was slow and how we sped it up

## Items
- [H-OC01] major · It lists the slow invoices query (index).
  evidence: text:any matches /invoice/i

- [H-OC02] major · It lists the large frontend bundle.
  evidence: text:any matches /bundle/i

- [H-OC03] major · It lists the slow zsh startup.
  evidence: text:any matches /zsh/i

- [H-OC04] major · It lists the slow CI builds (npm cache).
  evidence: text:any matches /CI|cache/i

- [H-PR01] major · The search used scope: all.
  evidence_any: call:search#1 args.scope == all ;; call:recall#1 args.scope == all ;; call:sql#1 args.sql present

- [H-PR02] major · Citations in the full form (ses_… #seq).
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:apply_patch
