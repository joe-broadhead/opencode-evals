# tools-get-meetings
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The notes of named meetings are read in one call, and the answer reports them in its own words.
- Data check: data=seeded; the seeded kickoff meeting exists in the evals-232 folder
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
summarise the evals-232 kickoff meeting

## Items
- [GRA-OC01] blocker · get_meetings answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:get_meetings#1

- [GRA-OC02] major · The answer reports the meeting's notes, naming the meeting it read.
  evidence_any: text:any matches /{{canary:granola_meeting}}/ ;; text:any matches /(kickoff|summary|action|decision)/i

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:granola.update_private_notes
  evidence: absent:granola.generate_summary

## Notes
- The canary is the seeded meeting title; the alternative keeps the case gradeable before the canary is seeded.
