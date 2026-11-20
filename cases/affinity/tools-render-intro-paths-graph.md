# tools-render-intro-paths-graph
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: render_intro_paths_graph (draws nothing here; the paths as a table)
- Decision tested: A render-the-paths request is one call, and the answer gives the paths as a table
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
render the intro paths to company 424242.

## Items
- [AFF-TR01] blocker · It used render_intro_paths_graph once.
  evidence: call:affinity.render_intro_paths_graph#1
- [AFF-PR01] major · It passed the paths it found.
  evidence: call:affinity.render_intro_paths_graph#1 args.paths present
- [AFF-OC01] major · The answer gives a table, not an image.
  evidence: text:any matches /(\||table|path|person)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

- [AFF-OC08] major · It says the object was not found, and invents nothing.
  evidence: text:any matches /(not found|couldn't find|could not find|no such|doesn't exist|does not exist|404|no (interviewer|interview|company|path|opportunity|set|task|dictionary|guide))/i

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
