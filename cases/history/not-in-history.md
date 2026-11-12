# not-in-history
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: no GraphQL session exists
- Decision tested: A topic that was never discussed: the agent must say it found nothing, after genuinely looking, and not invent a decision.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
what did we decide about GraphQL versus REST for the public API?

## Items
- [H-OC01] blocker · It says nothing was found in the history about GraphQL.
  evidence: text:any matches /no (record|session|discussion|mention|decision)|did not find|didn't find|couldn't find|could not find|nothing|not (find|found)|never (discussed|came up)/i

- [H-OC02] blocker · It does not state a decision as fact.
  evidence: text:any not-matches /(^|[.!?:]\s+|\n)(we|you) (decided|chose|went with|picked|settled on) (to use |on )?(GraphQL|REST)/i

- [H-OC08] major · It actually searched before concluding nothing exists.
  evidence: count:history.* >= 1

- [H-PR01] major · It tried more than one phrasing or widened the scope before giving up.
  evidence_any: call:history.search#1 args.query.length >= 2 ;; count:history.search >= 2 ;; count:history.* >= 2

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
