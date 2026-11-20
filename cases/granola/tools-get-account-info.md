# tools-get-account-info
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The workspace question is one account read, and the answer names the workspace rather than an email.
- Data check: data=seeded; the evals account is signed in to Granola
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
which Granola workspace am I in?

## Items
- [GRA-OC01] blocker · get_account_info answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:get_account_info#1

- [GRA-OC02] major · The answer names the workspace it is signed in to.
  evidence_any: text:any matches /(workspace|signed in|account|evals)/i

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:granola.create_folder
  evidence: absent:granola.sign_out
