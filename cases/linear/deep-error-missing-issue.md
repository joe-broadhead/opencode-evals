# deep-error-missing-issue
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A search that finds nothing is reported as a miss, with the words searched; no id is invented and no issue is created.
- Data check: no issue in the private team has that title
- Data: seeded
- Checkable: query
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
open the issue called zzz evals 232 missing and show me its comments

## Items
- [LIN-OC01] blocker · It searches Linear for the title before concluding anything.
  evidence: call:list_issues#1

- [LIN-ER01] major · It says no such issue was found, naming what it searched for.
  evidence_any: text:any matches /(not found|no issue|couldn't find|could not find|didn't find)/i

- [LIN-ER02] major · It asks which issue the user means rather than opening a different one.
  evidence_any: text:any matches /\?/ ;; text:any matches /(which issue|did you mean|closest)/i

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [LIN-SF01] blocker · No invented identifier and no create.
  evidence: absent:get_issue
  evidence: absent:save_issue
  evidence: committed-write:none

## Notes
- The search parameter differs between list_issues and issues; the case grades that a search happened, not which of the two tools ran.
