# deep-ambiguous-hiring
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: deep, ambiguous: 'how's the backend hiring going?'
- Decision tested: An ambiguous hiring question is resolved by asking which job or showing each matching job's counts, never one invented number
- Data check: two or more Ashby jobs match 'backend'
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: deep

## Prompt
how's the backend hiring going?

## Items
- [ASH-TR01] blocker · It read the pipeline rather than guessing.
  evidence: count:ashby.get_job_pipeline >= 1
- [ASH-RT01] major · It names the job or jobs it read, and asks which one if several match.
  evidence: text:any matches /(which job|two jobs|both jobs)/i
- [ASH-OC01] major · Every count it gives comes from a job it named.
  grader: judge
- [ASH-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · No stage move, archive or note was made.
  evidence: absent-write:ashby
  evidence: absent:write
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
