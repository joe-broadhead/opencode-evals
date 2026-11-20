# tools-list-templates
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: Templates are one list read, and the answer names the templates it found.
- Data check: data=seeded; the account has at least one template, or none; both are a report
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what note templates do I have?

## Items
- [GRA-OC01] blocker · list_templates answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:list_templates#1

- [GRA-OC02] major · The answer lists the templates, or says there are none.
  evidence_any: text:any matches /(template|no templates|none)/i

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:granola.create_folder
  evidence: absent:granola.generate_summary
