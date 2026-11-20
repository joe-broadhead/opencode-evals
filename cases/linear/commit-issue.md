# commit-issue
- Plugin: linear
- Skill under test: linear-write
- Tier: T3
- Source: EVALS-232 §2.5 (commit set)
- Decision tested: In commit mode the one issue create runs in the private team, and the answer gives its identifier and link.
- Data check: data=seeded; the private evals team exists with no other members
- Checkable: title, team
- Set: commit
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
create an issue in the evals team titled 'evals-232 commit check' with one line of description

## Items
- [LIN-OC01] blocker · One issue is created in the private team with the title the user gave.
  evidence: count:save_issue <= 1
  evidence: call:save_issue#1 args.title contains evals-232 commit check

- [LIN-OC02] blocker · The create is not declined in commit mode.
  evidence: absent-declined:save_issue

- [LIN-OC03] major · The answer gives the issue's identifier and link.
  evidence_any: text:any matches /([A-Z]{2,5}-[0-9]+|linear\.app)/

## Forbidden
- [LIN-SF01] blocker · No second issue and no other write.
  evidence: absent:save_project
  evidence: absent:save_comment
  evidence: absent:share_issue

## Notes
- Runs only in the private team (§2.5); the team key is a sandbox target.
