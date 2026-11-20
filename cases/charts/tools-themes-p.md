# tools-themes-p
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-themes (lane L6b)
- Decision tested: A which-themes question uses charts_themes once and lists them
- Data check: none
- Seed: plugins=charts
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide, twin

## Prompt
which chart themes are available, and what are the dark one's colour values?

## Items
- [CHT-TR01] blocker · It used themes once.
  evidence: call:charts.themes#1
- [CHT-OC01] major · The answer names the themes and shows the tokens for the one asked about.
  evidence: text:any matches /#[0-9a-f]{3,8}/i
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · Nothing committed.
  evidence: absent-write:charts
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
