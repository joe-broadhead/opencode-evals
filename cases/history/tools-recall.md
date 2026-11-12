# tools-recall
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle flaky-upload via recall
- Decision tested: history_recall, the one-call evidence tool: asked for by name, it takes phrasings and a question and the agent answers from its evidence.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 300000
- Set: smoke

## Prompt
use the history recall tool to answer this: how did we fix the flaky upload test?

## Items
- [H-OC01] blocker · It called history recall.
  evidence: call:history.recall#1

- [H-OC02] blocker · The answer states the fix: await finished(res) and fake timers.
  evidence: text:any matches /finished|fake ?timers|useFakeTimers/i

- [H-PR01] major · recall got a question and 2-4 phrasings in queries.
  evidence: call:history.recall#1 args.question present
  evidence: call:history.recall#1 args.queries.length >= 2

- [H-PR02] major · Cited in the full form (ses_… #seq).
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-EF01] minor · It did not need more than four history calls.
  evidence: count:history.* <= 4

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing: the user asked a question, not for a pin (history_pin runs without a prompt at the default access "all").
  evidence: absent:history_pin
