# tools-themes
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: wide sweep: charts_themes (built-in and saved themes, or one theme's tokens)
- Decision tested: A which-themes question uses charts_themes once and lists them
- Data check: none
- Seed: plugins=charts
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
what themes can I use for charts, and what does the dark one look like in tokens?

## Items
- [CHT-TR01] blocker · It used themes once.
  evidence: call:charts.themes#1
- [CHT-OC01] major · The answer names the themes and shows the tokens for the one asked about.
  evidence: text:any matches /(light|dark|theme|colour|color)/i
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
