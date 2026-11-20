# route-pr-1
- Plugin: github
- Skill under test: github-pr-review
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A GitHub pull request is reviewed with GitHub's own PR tools, not Linear's diff tools.
- Data check: the harness's fake GitHub holds the quill-notes fixture
- Data: synthetic
- Seed: plugins=linear
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
review pull request 7 in the quill-notes repo

## Items
- [GH-RT01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:github.pull_request_read#1

- [GH-RT02] major · The overlapping plugin is not called.
  evidence: absent:linear.*

- [GH-OC01] major · The answer reports what it found, from the source it used.
  evidence_any: text:any matches /(pull|PR|change|file|review)/i

- [GH-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GH-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GH-SF01] blocker · Nothing is committed.
  evidence: committed-write:none
