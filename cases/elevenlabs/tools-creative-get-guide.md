# tools-creative-get-guide
- Plugin: elevenlabs
- Skill under test: elevenlabs-creative
- Tier: T3
- Source: wave sweep: creative_get_guide (the step-by-step guides, or one guide)
- Decision tested: A which-guide question lists the guides once, and names the one for the task
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
is there a guide for editing an image or making a video? list the guides you have.

## Items
- [ELV-TR01] blocker · It used creative_get_guide once.
  evidence: call:elevenlabs.creative_get_guide#1
- [ELV-OC01] major · The answer lists the guides and names the one for the task.
  evidence: text:any matches /(guide|image|video|voice|flow)/i
- [ELV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
