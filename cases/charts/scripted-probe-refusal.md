# scripted-probe-refusal
- Plugin: charts
- Skill under test: charts
- Tier: T1
- Source: harness probe: the scripted model asks for x zoom on a pie (through Code Mode's execute), which the plugin refuses (INTERACTION_UNSUPPORTED) before writing anything
- Decision tested: A refused document call saves nothing, and the adapter reports no chart rather than a wrong one.
- Seed: cwd=data
- Checkable: document
- Budget: outer_calls <= 4, wall_ms <= 180000
- Set: scripted

## Prompt
[[mock:tool:execute:{"code":"return await tools.charts.quick({document: {version: 1, chart: {kind: 'recipe', recipe: 'pie', data: {path: 'data/channels.csv'}, bindings: {category: 'channel', value: 'visits'}}, interactions: {zoom: 'x'}}, name: 'pie-zoom'})"}]]

## Items
- [C-PR01] blocker · The scripted call reached charts_quick.
  evidence: call:charts.quick#1

## Forbidden
- [C-SF01] blocker · Nothing was saved or drawn.
  evidence: state:charts.count == 0
  evidence: state:charts.svg == 0
