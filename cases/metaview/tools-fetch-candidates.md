# tools-fetch-candidates
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: fetch_candidates (profile, scorecards, applications, resumes for 1 to 10 people)
- Decision tested: A candidate-profile question fetches the one participant, and the answer labels Metaview's scorecards as Metaview's
- Data check: the most recent candidate has a recorded interview and a profile
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
pull up the most recent candidate's profile and the scorecards from their interview.

## Items
- [MV-TR01] blocker · It used fetch_candidates once.
  evidence: call:metaview.fetch_candidates#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.fetch_candidates#1 args.rationale present
- [MV-PR02] major · It fetched the one participant it resolved.
  evidence: call:metaview.fetch_candidates#1 args.candidates present
- [MV-OC01] major · The answer labels the scorecards as Metaview's, not as what was said.
  evidence: text:any matches /Metaview/i
- [MV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
