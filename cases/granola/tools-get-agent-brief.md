# tools-get-agent-brief
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The user's own context is one brief read with the fields asked for, and it is background, not evidence of current work.
- Data check: data=seeded; the account has a role brief
- Checkable: fields
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what do you know about my role and the team I work with?

## Items
- [GRA-OC01] blocker · get_agent_brief answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:get_agent_brief#1

- [GRA-PR01] major · The call carries fields as the user gave it.
  evidence: call:get_agent_brief#1 args.fields == present

- [GRA-OC02] major · The answer reports the brief's fields and does not present them as current work.
  evidence_any: text:any matches /(role|team|work|brief)/i

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:granola.update_private_notes
  evidence: absent:granola.create_folder
