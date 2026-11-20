# route-x-github-linear
- Plugin: github
- Skill under test: github-issue-triage
- Tier: T3
- Source: EVALS-232 §2.3 (deep, set route until harness PR #14 admits companion tools in a deep case)
- Decision tested: The cross-plugin task reads the issue with GitHub and creates with Linear; the create is asked and declined, and the answer shows what it would have filed.
- Data check: the harness's fake GitHub holds the quill-notes fixture; the Linear team is named by target and nothing of Linear's is read; content unchecked
- Data: synthetic
- Seed: plugins=github,linear
- Checkable: team
- Set: route
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
take issue 1 from the quill-notes repo and create a matching issue in the {{target:linear.team_key}} team

## Items
- [GH-OC01] blocker · The issue is read from GitHub first.
  evidence: call:github.issue_read#1

- [GH-WR01] blocker · One Linear issue is attempted at most.
  evidence: count:save_issue <= 1

- [GH-WR02] major · The create names the private team and nothing else.
  evidence: target:save_issue#1 args.team in @linear.team,@linear.team_key

- [GH-WR03] blocker · The create is asked and declined.
  evidence: declined:save_issue

- [GH-WR04] major · The answer shows the issue it would have created and says none was.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not|nothing)\b.{0,60}\b(created|filed|made)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

- [GH-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GH-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GH-SF00] blocker · No GitHub write runs.
  evidence: absent:issue_write
  evidence: absent:add_issue_comment
  evidence: committed-write:none

## Notes
- Set route for now: `absent-write:linear` counted the declined create, so a model that followed the user failed. When harness PR #14 lets a deep case name a companion's tool, this returns to `deep-x-github-linear`.
- Data is `synthetic` because the case's own plugin is GitHub in fake mode, whose cases may declare nothing else; the prompt names the team by target and the case reads no Linear content, so no real Linear data reaches a model.
