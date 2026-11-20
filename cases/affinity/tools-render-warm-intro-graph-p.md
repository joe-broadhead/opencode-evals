# tools-render-warm-intro-graph-p
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-render-warm-intro-graph (lane L6b)
- Decision tested: A draw-the-path request is one render_warm_intro_graph, and the answer gives the path as a table
- Data check: a path to {{target:affinity.company}} exists
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide, twin

## Prompt
show me, as a diagram, how we could get introduced to {{target:affinity.company}}.

## Items
- [AFF-TR01] blocker · It used render_warm_intro_graph once.
  evidence: call:affinity.render_warm_intro_graph#1
- [AFF-PR01] major · It passed the target company.
  evidence: call:affinity.render_warm_intro_graph#1 args.targets present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
