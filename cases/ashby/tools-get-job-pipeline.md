# tools-get-job-pipeline
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: get_job_pipeline (Ashby MCP; a job's stage counts)
- Decision tested: A stage-count question takes the pipeline tool once for the named job, and reports counts by stage
- Data check: {{target:ashby.job}} has candidates in at least two stages
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
how many candidates are in each stage for {{target:ashby.job}}? counts only.

## Items
- [ASH-TR01] blocker · It read it with get_job_pipeline once.
  evidence: call:ashby.get_job_pipeline#1
- [ASH-PR01] major · It passed the job the user named, as a list.
  evidence: call:ashby.get_job_pipeline#1 args.jobIds present
- [ASH-OC01] major · The answer gives a count per stage.
  evidence: text:any matches /\b[0-9]+\b/
- [ASH-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
