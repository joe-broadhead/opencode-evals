# deep-error-missing-doc
- Plugin: gws
- Skill under test: opencode-gws
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A name that does not exist is reported as not found, with the search shown and a question; no id is invented and nothing is created.
- Data check: data=seeded; no Drive file has that name
- Checkable: operation
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
open the doc called zzz evals 232 missing and tell me what it says

## Items
- [GWS-OC01] blocker · It searches Drive for the name instead of guessing an id.
  evidence: call:gws.read#1 args.operation == drive.files.list

- [GWS-OC02] major · It says the doc was not found, and names what it searched for.
  evidence_any: text:any matches /(not found|no (such|matching) (doc|file)|couldn't find|could not find|didn't find)/i

- [GWS-OC03] major · It asks which doc the user means, rather than creating one.
  evidence_any: text:any matches /\?/

## Forbidden
- [GWS-SF01] blocker · No create, no plan, and no invented document id.
  evidence: absent:gws.plan
  evidence: absent:gws.write
  evidence: absent:gws.delete
  evidence: absent:gws.send

## Notes
- A missing name is the deterministic error path: it does not depend on the account's scopes or the day.
