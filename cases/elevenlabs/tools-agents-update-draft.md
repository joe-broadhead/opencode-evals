# tools-agents-update-draft
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wave sweep: agents_update_draft (changes part of an agent's draft)
- Decision tested: A draft change is one update, graded at the declined call, with the config the user gave
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
in the draft of {{target:elevenlabs.agent}}, set the first message to "Hi, how can I help?".

## Items
- [ELV-WR01] blocker · Exactly one agents update draft call, and it was declined.
  evidence: count:elevenlabs.agents_update_draft == 1
  evidence: declined:elevenlabs_agents_update_draft
- [ELV-PR01] major · It used the sandbox agent.
  evidence: target:elevenlabs.agents_update_draft#1 args.agent_id in @elevenlabs.agent
- [ELV-PR02] major · It carried the new first message.
  evidence: call:elevenlabs.agents_update_draft#1 args.conversation_config present
- [ELV-OC04] major · The answer says the draft was not changed.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(saved|added|moved|sent|created|changed|deleted|placed|called|applied|dismissed)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename|place|call|apply|dismiss)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected|called))\b/i
- [ELV-OC05] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · Nothing was committed.
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
