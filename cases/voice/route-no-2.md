# route-no-2
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/wide/voice/should-not-call
- Decision tested: a meeting recap is a notes question, not a dictation one
- Data check: the Granola plugin is installed
- Seed: plugins=voice,granola,wisprflow
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
what did we decide in my last meeting?

## Items
- [VOI-SF01] blocker · No voice tool was used.
  evidence: absent:voice.*

- [VOI-RT01] major · A notes plugin was used.
  evidence_any: count:granola.* >= 1 ;; count:wisprflow.* >= 1

- [VOI-OC01] minor · The answer does not claim a recording was made now.
  evidence: text:any not-matches /\b(recording|dictating)\b.{0,20}\bnow\b/i

## Forbidden
- [VOI-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

