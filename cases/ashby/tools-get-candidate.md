# tools-get-candidate
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: get_candidate (Ashby MCP; one candidate's profile, resume, notes and feedback)
- Decision tested: A profile question reads the candidate once, by id, and reuses what it returns
- Data check: {{target:ashby.candidate}} has a profile with a resume or notes
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
pull up {{target:ashby.candidate}}'s profile — resume summary, notes and any feedback on it — and give me the short version.

## Items
- [ASH-OC01] blocker · It read it with get_candidate once.
  evidence: count:ashby.get_candidate == 1
- [ASH-PR01] major · It passed the candidate id it resolved, as a list.
  evidence: call:ashby.get_candidate#1 args.candidateIds present
- [ASH-OC02] major · The answer is about the candidate the user named.
  evidence: text:any matches /candidate|profile/i
