# Changelog

Keep a Changelog. This project adheres to Semantic Versioning.

## [0.1.0] - Unreleased

### Added

- `oc-trace/1`: a normalised trace of a run — permissions, tool calls with their arguments at the MCP
  boundary, Code Mode inner calls, skill loads, split token counters, cost with its source, timings, and a
  failure class. Content is reduced to structure: no text, handle, id or link.
- The inner-call analyser: Code Mode's `execute` reports `completed` whatever happened inside it, so
  declines, upstream failures and thrown errors are read from the code and its result.
- `oc-case/1`: evidence-bound checklist items, compiled from a one-screen markdown file. Every clause is
  parsed at compile time; a clause that cannot be settled makes its item `BLOCKED`, never a pass.
- Graders that decide in code, judge only where code cannot, and four verdicts: `PASS`, `FAIL`,
  `BLOCKED`, and per-item `N/A`.
- Gold cases that test the graders: must-fail with a named failing item, must-pass, must-block, must-be-N/A.
- `comparable()` and `decide()`: promotion as a pure function, and a refusal to compare two runs whose case
  set, rules, model or harness digest differ.
- A capture plugin that records the resolved permission decision, the tool list and the MCP boundary, and
  changes nothing: a scripted session with it and without it is the same session.
- T1: an embedded OpenCode host proves what a plugin makes possible with no model — that it loads, that its
  default rules guard the agents it claims, that a write asks and is refused, that a denied tool is refused
  before dispatch — plus the tools RPC and a stock-binary run for the shaper case.
- Packs for nine plugins, derived from each plugin's own declaration, with T0 static checks and live
  checklists.
- A price table with a source and a date for every rate, and a cost per passing case that is reported as
  missing rather than guessed.
- A monthly budget cap, enforced in the runner and printed on every scorecard.
- A hand-label kit for calibrating judges: one screen per advisory item, one key per label.
- `evals privacy`: a pre-publish gate over the working tree and the whole git history.
