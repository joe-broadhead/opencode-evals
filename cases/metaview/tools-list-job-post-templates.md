# tools-list-job-post-templates
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_job_post_templates (the workspace's post templates)
- Decision tested: A list-templates question is one list_job_post_templates
- Data check: candidate data: at least one job post template
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
list our job post templates.

## Items
- [MV-OC01] blocker · It used list_job_post_templates once.
  evidence: count:metaview.list_job_post_templates == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_job_post_templates#1 args.rationale present
- [MV-OC03] major · The answer lists them, or says there are none.
  evidence: text:any matches /(template|none)/i
