# deep-error-missing-page
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A page that does not exist is reported as a miss, with the words searched; no page is created and no id is guessed.
- Data check: no page in the workspace has that title
- Data: seeded
- Checkable: query
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
open the page called zzz evals 232 missing and tell me what it says

## Items
- [NOT-OC01] blocker · It searches before concluding anything.
  evidence: call:notion-search#1

- [NOT-ER01] major · It says no page was found, naming what it searched for.
  evidence_any: text:any matches /(not found|no page|couldn't find|could not find|didn't find)/i

- [NOT-ER02] major · It asks which page the user means rather than creating one.
  evidence_any: text:any matches /\?/ ;; text:any matches /(which page|did you mean|closest)/i

- [NOT-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [NOT-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [NOT-SF01] blocker · No page is created and nothing is fetched by a guessed id.
  evidence: absent-write:notion
  evidence: absent:notion-fetch
  evidence: committed-write:none
