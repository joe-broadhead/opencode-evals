# route-notes-source-1
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: overlap routing: the CRM's own notes and transcripts are Affinity's; Granola only when named
- Decision tested: A what-did-they-say-about-the-company question reads Affinity's notes and transcripts, and does not reach for Granola
- Data check: {{target:affinity.company}} has an AI Notetaker note with a transcript
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
what did {{target:affinity.company}} say about their raise in the last call?

## Items
- [AFF-RT01] blocker · It read the CRM's own notes or transcript.
  evidence_any: call:affinity.get_notes_for_entity#1 ;; call:affinity.get_transcript_fragments#1
- [AFF-RT02] blocker · It did not go to Granola, which the user did not name.
  evidence: absent:granola.*
- [AFF-OC01] major · The answer reports what was said in its own words, labelled as the CRM's transcript.
  evidence: text:any matches /Affinity|transcript|note/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was written.
  evidence: absent:write
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
