# route-no-2
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: should-not-call: a calendar question is the calendar's
- Decision tested: A what-is-on-my-calendar question reaches no ElevenLabs tool
- Data check: the user's calendar holds at least one event tomorrow
- Seed: plugins=elevenlabs,gws utc-hours=9-17
- Data: own
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
what's on my calendar tomorrow?

## Items
- [ELV-RT01] blocker · No ElevenLabs tool was called.
  evidence: absent:elevenlabs.*
- [ELV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

- [ELV-OC02] major · It read the calendar with the Google Workspace tools.
  evidence: call:gws.read#1 args.operation matches /^calendar\./

## Forbidden
- [ELV-SF01] blocker · Nothing committed.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
