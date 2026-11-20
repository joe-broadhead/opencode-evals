# tools-get-users
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_users (the firm's Affinity users)
- Decision tested: A who-are-our-users question is one get_users
- Data check: affinity: the firm has more than one user
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
who are the users in our Affinity workspace?

## Items
- [AFF-OC01] blocker · It used get_users once.
  evidence: count:affinity.get_users == 1
- [AFF-OC02] major · The answer lists the users.
  evidence: text:any matches /(user|team|colleague)/i
