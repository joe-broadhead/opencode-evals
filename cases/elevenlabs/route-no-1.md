# route-no-1
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: should-not-call: account help has no tool
- Decision tested: A password-reset question reaches no ElevenLabs tool
- Data check: none
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
how do I reset my ElevenLabs password?

## Items
- [ELV-RT01] blocker · No ElevenLabs tool was called.
  evidence: absent:elevenlabs.*
- [ELV-OC01] major · The answer points at ElevenLabs' own account settings.
  evidence: text:any matches /(account settings|settings page|support|help centre)/i
- [ELV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · Nothing committed.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
