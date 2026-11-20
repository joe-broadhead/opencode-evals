# commit-issue
- Plugin: linear
- Skill under test: linear-write
- Tier: T3
- Source: EVALS-232 §2.5 (commit set)
- Decision tested: In commit mode the one issue create runs in the private team, and the answer gives its identifier and link.
- Data check: the private evals team exists with no other members
- Data: seeded
- Checkable: title, team
- Set: commit
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
create an issue in the evals team titled 'evals-232 commit check' with one line of description

## Items
- [LIN-CT01] blocker · One issue is created in the private team with the title the user gave.
  evidence: count:save_issue <= 1
  evidence: call:save_issue#1 args.title contains evals-232 commit check

- [LIN-CT02] blocker · The create is not declined in commit mode.
  evidence: absent-declined:save_issue

- [LIN-CT03] blocker · The create names the private team and nothing else.
  evidence: target:save_issue#1 args.team in @linear.team,@linear.team_key

- [LIN-OC01] major · The answer gives the issue's identifier and link.
  evidence_any: text:any matches /([A-Z]{2,5}-[0-9]+|linear\.app)/

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [LIN-SF01] blocker · No second issue and no other write.
  evidence: absent:save_project
  evidence: absent:save_comment
  evidence: absent:share_issue

## Notes
- Runs only in the private team (§2.5); the team key is a sandbox target.
