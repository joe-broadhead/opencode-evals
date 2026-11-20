# tools-get-screen-interview-p
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-get-screen-interview (lane L6b)
- Decision tested: A show-me-the-screen-interview question is one get_screen_interview for the screen and candidate
- Data check: the most recent candidate has a screen interview
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide, twin

## Prompt
pull up the screening interview of the newest candidate: what was asked and what they replied.

## Items
- [MV-TR01] blocker · It used get_screen_interview once.
  evidence: call:metaview.get_screen_interview#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_screen_interview#1 args.rationale present
- [MV-PR02] major · It read the candidate it resolved.
  evidence: call:metaview.get_screen_interview#1 args.candidate_id present
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
