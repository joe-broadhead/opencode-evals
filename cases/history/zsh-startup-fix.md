# zsh-startup-fix
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle zsh-startup
- Decision tested: A personal-setup question from a different project (dotfiles).
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Status: retired

## Prompt
how did I fix my slow zsh startup before? it's creeping up again

## Items
- [H-OC01] blocker · The fix is stated: lazy-loading nvm.
  evidence: text:any matches /lazy[- ]?load|lazy/i

- [H-OC02] major · The numbers are stated: 1.9s to 0.18s.
  evidence: text:any matches /1\.9 ?s/i
  evidence: text:any matches /0\.18 ?s/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: zsh-startup.
  evidence: text:any matches /ses_lUf94bevHCHcZYV2dMIA8e/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_lUf94bevHCHcZYV2dMIA8e #[0-9]+\)/

- [H-PR03] minor · A search or recall call used at least two phrasings of the topic.
  evidence_any: call:history.search#1 args.query.length >= 2 ;; call:history.recall#1 args.queries.length >= 2
  n/a_when: absent:history.search
  n/a_when: absent:history.recall

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

- [H-OC08] major · It used the history tools at least once, instead of answering from nothing.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
