# tools-render-intro-paths-graph
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: render_intro_paths_graph (draws nothing in OpenCode: the skill says don't call it; get the paths and give a table)
- Decision tested: A render-the-paths request reads the paths with get_intro_paths and answers as a table, and does not call render_intro_paths_graph
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
render the intro paths to company 424242.

## Items
- [AFF-TR01] blocker · It used get_intro_paths once.
  evidence: call:affinity.get_intro_paths#1
- [AFF-PR01] major · It read the company the user named.
  evidence: call:affinity.get_intro_paths#1 args.company_id == 424242
- [AFF-OC01] major · The answer gives the paths as a short table, or says none were found, and does not claim to have drawn an image.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · It did not call render_intro_paths_graph: the skill says draw nothing and give a table.
  evidence: absent:affinity.render_intro_paths_graph
- [AFF-SF02] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF03] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
