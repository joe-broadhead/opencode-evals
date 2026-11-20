# tools-get-candidate
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: get_candidate (Ashby MCP; one candidate's profile, resume, notes and feedback)
- Decision tested: A profile question reads the candidate once, by id, and reuses what it returns
- Data check: the shortlisted candidate has a profile with a resume or notes
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
pull up the shortlisted candidate's profile — resume summary, notes and any feedback on it — and give me the short version.

## Items
- [ASH-TR01] blocker · It read it with get_candidate once.
  evidence: call:ashby.get_candidate#1
- [ASH-PR01] major · It passed the candidate id it resolved, as a list.
  evidence: call:ashby.get_candidate#1 args.candidateIds present
- [ASH-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: absent-write:ashby
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
