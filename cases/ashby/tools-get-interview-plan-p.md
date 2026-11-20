# tools-get-interview-plan-p
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-get-interview-plan (lane L6b)
- Decision tested: A job's stages are read from its interview plan, by job id
- Data check: {{target:ashby.job}} has at least two interview stages
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide, twin

## Prompt
walk me through the interview rounds for {{target:ashby.job}}, in sequence and with what each involves rather than just titles.

## Items
- [ASH-TR01] blocker · It read it with get_interview_plan once.
  evidence: call:ashby.get_interview_plan#1
- [ASH-PR01] major · It passed the job the user named.
  evidence: call:ashby.get_interview_plan#1 args.jobId present
- [ASH-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: absent-write:ashby
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
