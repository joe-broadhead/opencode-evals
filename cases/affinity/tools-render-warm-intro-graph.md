# tools-render-warm-intro-graph
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: render_warm_intro_graph (draws nothing here; the same data as a short table)
- Decision tested: A draw-the-path request is one render_warm_intro_graph, and the answer gives the path as a table
- Data check: a path to {{target:affinity.company}} exists
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
draw the warm intro path to {{target:affinity.company}}.

## Items
- [AFF-TR01] blocker · It used render_warm_intro_graph once.
  evidence: call:affinity.render_warm_intro_graph#1
- [AFF-PR01] major · It passed the target company.
  evidence: call:affinity.render_warm_intro_graph#1 args.targets present
- [AFF-OC01] major · The answer gives the path as a short table.
  evidence: text:any matches /(\||path|intro|table)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
