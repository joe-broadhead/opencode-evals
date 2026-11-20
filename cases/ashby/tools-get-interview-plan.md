# tools-get-interview-plan
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: get_interview_plan (Ashby MCP; a job's interview stages)
- Decision tested: A job's stages are read from its interview plan, by job id
- Data check: {{target:ashby.job}} has at least two interview stages
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
what are the interview stages for {{target:ashby.job}}? I want the order, not just the names.

## Items
- [ASH-TR01] blocker · It read it with get_interview_plan once.
  evidence: call:ashby.get_interview_plan#1
- [ASH-PR01] major · It passed the job the user named.
  evidence: call:ashby.get_interview_plan#1 args.jobId present
- [ASH-OC01] major · The answer lists the stages in order.
  evidence: text:any matches /stage|interview/i
- [ASH-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
