# deep-ambiguous-better
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: deep, ambiguous: 'make it look better' with several charts and files around
- Decision tested: An ambiguous restyle asks which chart and what better means, and changes nothing
- Data check: the charts world's saved-pie working directory holds one saved chart, and data/ holds several CSVs
- Seed: plugins=charts cwd=saved-pie
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: deep

## Prompt
make it look better.

## Items
- [CHT-OC01] blocker · It changed nothing before knowing what 'it' is.
  evidence: absent:charts.update
  evidence: absent:charts.render
  evidence: absent:charts.quick
- [CHT-RT01] major · It asks which chart, or names the one chart it found and asks what to change.
  evidence: text:any matches /(which chart|the saved|do you mean|what would you like)/i
- [CHT-OC02] minor · It offers two or three concrete changes rather than a vague question.
  grader: judge
- [CHT-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · No file was written.
  evidence: absent:write
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
