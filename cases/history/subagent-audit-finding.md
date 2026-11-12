# subagent-audit-finding
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needles audit-parent / audit-catalog
- Decision tested: The findings exist only in a subagent session (the parent just says DONE): the agent must reach it (includeSubagents, or brief with children).
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Set: core, screen

## Prompt
what did the catalog audit subagent find? it wrote to AUDIT.md but I never read it

## Items
- [H-OC01] blocker · The cacheKey() bug is reported: it ignores locale.
  evidence: text:any matches /locale/i

- [H-OC02] blocker · The missing index is reported: products(slug).
  evidence: text:any matches /slug/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: audit-catalog.
  evidence: text:any matches /ses_D8ghE1UX84eI4yq5qFfsHu/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_D8ghE1UX84eI4yq5qFfsHu #[0-9]+\)/

- [H-PR03] minor · A search or recall call used at least two phrasings of the topic.
  evidence_any: call:history.search#1 args.query.length >= 2 ;; call:history.recall#1 args.queries.length >= 2
  n/a_when: absent:history.search
  n/a_when: absent:history.recall

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

- [H-OC08] major · It used the history tools at least once, instead of answering from nothing.
  evidence: count:history.* >= 1

- [H-PR05] minor · It reached the subagent session: includeSubagents on a search or recall, brief with children, a read of the subagent session, or sql.
  evidence_any: call:history.search#1 args.includeSubagents == true ;; call:history.search#2 args.includeSubagents == true ;; call:history.recall#1 args.includeSubagents == true ;; call:history.brief#1 args.children == true ;; call:history.brief#2 args.children == true ;; call:history.read#1 ;; call:history.sql#1

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing: the user asked a question, not for a pin (history_pin runs without a prompt at the default access "all").
  evidence: absent:history_pin
