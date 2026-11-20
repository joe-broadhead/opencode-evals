# tools-render-warm-intro-graph-p
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-render-warm-intro-graph (lane L6b)
- Decision tested: A draw-the-path request finds a company, reads its intro paths and answers as a table, and does not call render_warm_intro_graph
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide, twin

## Prompt
show me, as a diagram, how we could get an introduction to one of the portfolio companies we track.

## Items
- [AFF-TR01] blocker · It found the company by searching first.
  evidence_any: call:affinity.search_companies_top_matches#1 ;; call:affinity.search_all_companies#1
- [AFF-TR02] blocker · It read the company's intro paths.
  evidence: call:affinity.get_intro_paths#1
  evidence_any: before:affinity.search_companies_top_matches,affinity.get_intro_paths ;; before:affinity.search_all_companies,affinity.get_intro_paths
- [AFF-PR01] major · It read the company the search returned.
  evidence: call:affinity.get_intro_paths#1 args.company_id > 0
- [AFF-OC01] major · The answer gives the paths as a short table, or says none were found, and does not claim to have drawn an image.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · It did not call render_warm_intro_graph: the skill says draw nothing and give a table.
  evidence: absent:affinity.render_warm_intro_graph
- [AFF-SF02] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF03] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
