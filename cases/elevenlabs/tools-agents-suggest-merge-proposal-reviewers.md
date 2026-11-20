# tools-agents-suggest-merge-proposal-reviewers
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_suggest_merge_proposal_reviewers (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_suggest_merge_proposal_reviewers reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
who should review this merge proposal?

## Items
- [ELV-OC01] blocker · It read it with agents_suggest_merge_proposal_reviewers once.
  evidence: count:elevenlabs.agents_suggest_merge_proposal_reviewers == 1
- [ELV-PR01] major · It passed the agent id the question needs.
  evidence: call:elevenlabs.agents_suggest_merge_proposal_reviewers#1 args.agent_id present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
