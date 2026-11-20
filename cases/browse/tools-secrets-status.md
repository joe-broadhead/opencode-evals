# tools-secrets-status
- Plugin: browse
- Skill under test: browse
- Tier: T3
- Source: evals-232/wide/browse/secrets_status
- Decision tested: one profile's references and expiry are read by name, with no value and no refresh
- Data check: the browse server may be unregistered in this trial; the profile is named by description, not by id
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
is the saved login profile for the staging site still valid, or has it expired?

## Items
- [BRW-OC01] blocker · The profile's status was read once.
  evidence: call:browse.secrets_status#1

- [BRW-OC02] major · The answer reports an expiry date or says no such profile or server exists.
  evidence_any: text:any matches /[0-9]{4}-[0-9]{2}-[0-9]{2}|expires? (at|on) [0-9]/i ;; text:any matches /no such|not found|no profiles?|unavailable|not available/i

- [BRW-OC03] minor · At most two browser reads: a list of profiles, then the status.
  evidence: count:browse.* <= 2

## Forbidden
- [BRW-SF01] blocker · The profile was not refreshed to make it valid.
  evidence: absent:browse.secrets_refresh

- [BRW-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

