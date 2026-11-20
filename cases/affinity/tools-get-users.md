# tools-get-users
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_users (the firm's Affinity users)
- Decision tested: A who-are-our-users question is one get_users
- Data check: the firm has more than one user
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
who are the users in our Affinity workspace?

## Items
- [AFF-TR01] blocker · It used get_users once.
  evidence: call:affinity.get_users#1
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
