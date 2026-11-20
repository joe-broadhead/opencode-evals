# snc-meeting
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/wide/voice/should-not-call
- Decision tested: a meeting recap is a notes question, not a dictation one
- Data check: the Granola plugin is installed
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
what did we decide in my last meeting?

## Items
- [VOI-SF01] blocker · No voice tool was used.
  evidence: absent:voice.*

- [VOI-TR01] major · A notes plugin was used.
  evidence_any: count:granola.* >= 1 ;; count:wisprflow.* >= 1

- [VOI-OC01] minor · The answer does not claim a recording was made now.
  evidence: text:any not-matches /\b(recording|dictating)\b.{0,20}\bnow\b/i
