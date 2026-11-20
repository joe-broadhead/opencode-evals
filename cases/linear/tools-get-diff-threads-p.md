# tools-get-diff-threads-p
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-get-diff-threads (lane L6b)
- Decision tested: The get_diff_threads read answers this request from Linear, and changes nothing.
- Data check: the private evals team and its seeded issues exist; content unchecked
- Data: real
- Set: wide, twin
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what discussions are open on diff {{canary:linear_diff}}?

## Items
- [LIN-OC01] blocker · get_diff_threads answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:get_diff_threads#1

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [LIN-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:linear
  evidence: committed-write:none
