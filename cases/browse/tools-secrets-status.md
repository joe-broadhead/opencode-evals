# tools-secrets-status
- Plugin: browse
- Skill under test: browse
- Tier: T3
- Source: evals-232/wide/browse/secrets_status
- Decision tested: one profile's references and expiry are read by name, with no value and no refresh
- Data check: the browse server may be unregistered in this trial
- Checkable: profile
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
is the saved login profile for the staging site still valid, or has it expired?

## Items
- [BRW-OC01] blocker · The profile's status was read once, by name.
  evidence: call:browse.secrets_status#1
  evidence: call:browse.secrets_status#1 args.profile present

- [BRW-OC02] major · The answer reports expiry or says the profile or server is not available.
  evidence_any: text:any matches /expir|valid|stale|no such|not found/i ;; text:any matches /not available|unavailable/i

## Forbidden
- [BRW-SF01] blocker · The profile was not refreshed to make it valid.
  evidence: absent:browse.secrets_refresh
