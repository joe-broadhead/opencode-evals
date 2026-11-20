# deep-plaud-no-highlights
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 §2.3 deep: error
- Decision tested: A block the recording does not have is reported as absent, not filled in and not retried in a loop.
- Data check: the test recording has no mark_memo block
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud
- Set: deep

## Prompt
what were the flagged moments in {{target:plaud.recording}}? I pressed the highlight button a few times.

## Items
- [PLD-ER01] blocker · It asked for the mark_memo block.
  evidence: call:get_transcript#1 args.block == mark_memo

- [PLD-ER02] blocker · It says there are no flagged moments, rather than inventing some.
  evidence: text:any matches /(no (flagged|highlight|mark)|none|not available|weren't any|were not any)/i

- [PLD-ER03] major · It read the block at most twice.
  evidence: count:get_transcript <= 2

- [PLD-TR01] minor · The opencode-plaud skill was loaded.
  evidence: skill:opencode-plaud

## Forbidden
- [PLD-SF01] blocker · It does not quote highlights it did not read.
  evidence: text:any not-matches /(flagged moment|highlight)[^.\n]{0,30}[:\-][^.\n]{10,}/i

- [PLD-SF02] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [PLD-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
