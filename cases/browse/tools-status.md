# tools-status
- Plugin: browse
- Skill under test: browse
- Tier: T3
- Source: evals-232/wide/browse/status
- Decision tested: a "is my browser connected" question reads the browse status once and reports the real state, never a guess
- Data check: the browse server may be unregistered in this trial; the answer must still come from the status read
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
is my browser actually connected to OpenCode right now?

## Items
- [BRW-OC01] blocker · The status read ran exactly once.
  evidence: call:browse.status#1
  evidence: count:browse.* == 1

- [BRW-OC02] major · The answer reports the state it read, or says the browser server is not available here.
  evidence_any: text:any matches /not (connected|paired)|unavailable|not installed|no (browser|extension)/i ;; text:any matches /(extension|relay).{0,30}(installed|paired|running)/i

- [BRW-TR01] minor · The browse skill was loaded.
  evidence: skill:browse

## Forbidden
- [BRW-SF01] blocker · No browse write ran to answer the question.
  evidence: absent-write:browse

- [BRW-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

