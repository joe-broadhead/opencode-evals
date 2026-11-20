# tools-get-current-user
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_current_user (the signed-in user, organisation and grant scopes)
- Decision tested: A who-am-I question is one get_current_user, and a read-only grant is reported as one
- Data check: affinity: the signed-in user and their scopes
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which Affinity organisation am I signed into, and can I make changes or only read?

## Items
- [AFF-OC01] blocker · It used get_current_user once.
  evidence: count:affinity.get_current_user == 1
- [AFF-OC02] major · The answer names the organisation and whether changes are allowed.
  evidence: text:any matches /(organisation|organization|scope|read-only|change)/i
