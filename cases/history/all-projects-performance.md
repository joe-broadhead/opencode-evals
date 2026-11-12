# all-projects-performance
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needles billing-index, bundle-size, zsh-startup, ci-cache
- Decision tested: An explicit 'any project' question: scope all, several sessions.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Set: core, screen

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
  evidence: text:any matches /npm cache|cache (key|hit|miss)|package-lock|hit rate|\b11 ?m(in)?\b/i

- [H-PR01] major · A search, recall, list or files call used scope: all (or one sql statement, which sees every project).
  evidence_any: call:history.search#1 args.scope == all ;; call:history.search#2 args.scope == all ;; call:history.search#3 args.scope == all ;; call:history.recall#1 args.scope == all ;; call:history.recall#2 args.scope == all ;; call:history.sessions#1 args.scope == all ;; call:history.files#1 args.scope == all ;; call:history.sql#1

- [H-PR02] major · Citations in the full form (ses_… #seq).
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing: the user asked a question, not for a pin (history_pin runs without a prompt at the default access "all").
  evidence: absent:history_pin
