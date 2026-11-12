# false-premise-kafka
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle kafka-eval
- Decision tested: A question that presumes something that never happened: the history shows Kafka was only evaluated and rejected.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
when did we migrate our event pipeline to Kafka, and how did it go?

## Items
- [H-OC01] blocker · It says there was no migration to Kafka (it was evaluated and rejected).
  evidence: text:any matches /no migration|never migrated|did not migrate|didn't migrate|not migrated|rejected|decided against|no record/i

- [H-OC02] blocker · It does not invent a migration date or outcome.
  evidence: text:any not-matches /(migrated|moved|switched) (our|the)[^.]{0,40}to Kafka (on|in|last|during)|migration (completed|went)/i

- [H-OC03] major · It reports what was actually decided: SNS+SQS fan-out.
  evidence: text:any matches /SNS/i

- [H-OC09] major · It cites the evaluation session.
  evidence: text:any matches /ses_8G0taG00jGp0r0dbuaUt9U/

- [H-OC08] major · It checked the history first.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
