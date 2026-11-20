# tools-get-emails-p
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-get-emails (lane L6b)
- Decision tested: A logged-emails question is one get_emails for the window
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide, twin

## Prompt
pull up the emails that have been logged over the past seven days.

## Items
- [AFF-TR01] blocker · It used get_emails once.
  evidence: call:affinity.get_emails#1
- [AFF-PR01] major · It bounded the window.
  evidence: call:affinity.get_emails#1 args.filter_expr present
- [AFF-OC01] major · The answer lists the emails the tool returned, or says there are none, and does not claim to show message bodies.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
