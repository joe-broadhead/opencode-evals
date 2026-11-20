# tools-creative-list-voices-p
- Plugin: elevenlabs
- Skill under test: elevenlabs-creative
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-creative-list-voices (lane L6b)
- Decision tested: A request for what creative_list_voices reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide, twin

## Prompt
which voices can I pick from in this workspace?

## Items
- [ELV-TR01] blocker · It read it with creative_list_voices once.
  evidence: call:elevenlabs.creative_list_voices#1
- [ELV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
