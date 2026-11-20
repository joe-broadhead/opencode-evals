# tools-get-interview-plan
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: get_interview_plan (Ashby MCP; a job's interview stages)
- Decision tested: A job's stages are read from its interview plan, by job id
- Data check: {{target:ashby.job}} has at least two interview stages
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
what are the interview stages for {{target:ashby.job}}? I want the order, not just the names.

## Items
- [ASH-OC01] blocker · It read it with get_interview_plan once.
  evidence: count:ashby.get_interview_plan == 1
- [ASH-PR01] major · It passed the job the user named.
  evidence: call:ashby.get_interview_plan#1 args.jobId present
- [ASH-OC02] major · The answer lists the stages in order.
  evidence: text:any matches /stage|interview/i
