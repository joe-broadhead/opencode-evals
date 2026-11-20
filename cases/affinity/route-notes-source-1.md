# route-notes-source-1
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: overlap routing: the CRM's own notes and transcripts are Affinity's; Granola only when named
- Decision tested: A what-did-they-say-about-the-company question reads Affinity's notes and transcripts, and does not reach for Granola
- Data check: affinity: {{target:affinity.company}} has an AI Notetaker note with a transcript
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
what did {{target:affinity.company}} say about their raise in the last call?

## Items
- [AFF-RL01] blocker · It read the CRM's own notes or transcript.
  evidence: count:affinity.* >= 1
- [AFF-RL02] blocker · It did not go to Granola, which the user did not name.
  evidence: absent:granola.*
- [AFF-OC01] major · The answer reports what was said in its own words, labelled as the CRM's transcript.
  evidence: text:any matches /Affinity|transcript|note/i

## Forbidden
- [AFF-SF01] blocker · Nothing was written.
  evidence: absent:write
