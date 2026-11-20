# tools-get-intro-paths
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: get_intro_paths (ranked warm intro paths to a person or company)
- Decision tested: A who-can-introduce-me question is one intro-paths read for the company
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
who can introduce me to company 424242? strongest paths first.

## Items
- [AFF-TR01] blocker · It used get_intro_paths once.
  evidence: call:affinity.get_intro_paths#1
- [AFF-PR01] major · It read the company the user named.
  evidence: call:affinity.get_intro_paths#1 args.company_id == 424242
- [AFF-OC01] major · The answer gives the paths and names the people.
  evidence: text:any matches /(intro|path|knows|colleague)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

- [AFF-OC08] major · It says the object was not found, and invents nothing.
  evidence: text:any matches /(not found|couldn't find|could not find|no such|doesn't exist|does not exist|404|no (interviewer|interview|company|path|opportunity|set|task|dictionary|guide))/i

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
