# snc-reminder
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/wide/voice/should-not-call
- Decision tested: a reminder is a scheduled job, not a spoken message now
- Data check: the Jobs plugin is installed
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
remind me at 9 tomorrow morning to call the bank

## Items
- [VOI-SF01] blocker · No voice tool was used.
  evidence: absent:voice.*

- [VOI-TR01] major · A jobs tool was used instead.
  evidence: count:jobs.* >= 1

- [VOI-OC01] minor · The answer does not say it will speak the reminder aloud.
  evidence: text:any not-matches /\b(speak|read aloud)\b.{0,30}\bremind/i
