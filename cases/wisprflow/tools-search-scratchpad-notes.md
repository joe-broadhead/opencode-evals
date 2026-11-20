# tools-search-scratchpad-notes
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A note by topic is one search_scratchpad_notes call, then a read of the best hit.
- Data check: a Scratchpad note about the hiring plan exists
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
find my Scratchpad note about the hiring plan.

## Items
- [WF-OC01] blocker · Exactly one search_scratchpad_notes call.
  evidence: count:search_scratchpad_notes == 1

- [WF-PR01] major · The query is the user's topic.
  evidence: call:search_scratchpad_notes#1 args.query present

- [WF-OC02] major · The answer names the note it found.
  evidence: text:any matches /(hiring|note)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
