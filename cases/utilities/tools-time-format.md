# tools-time-format
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_format (ISO 8601, RFC 3339, RFC 2822 or a Unix timestamp)
- Decision tested: A reformat question is one time_format to the format asked for
- Data check: none
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
turn 2026-11-18T09:00:00Z into a Unix timestamp.

## Items
- [UTL-TR01] blocker · It used time_format once.
  evidence: call:utilities.time_format#1
- [UTL-PR01] major · It asked for the epoch form.
  evidence: call:utilities.time_format#1 args.output_format matches /epoch|unix/i
- [UTL-OC01] major · The answer gives one number, as seconds.
  evidence: text:any matches /\b1[0-9]{9}\b/
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
