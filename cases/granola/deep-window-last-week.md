# deep-window-last-week
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A past week is one search bounded by both dates, and each meeting is reported with its date and a one-line subject.
- Data check: data=seeded; the sandbox folder holds last week's meetings, or none
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
which meetings did I have last week, and what was each about?

## Items
- [GRA-OC01] blocker · The week is one search with both bounds.
  evidence: call:search_meetings#1 args.from_date present
  evidence: call:search_meetings#1 args.to_date present

- [GRA-OC02] major · The answer gives each meeting's date and what it was about.
  evidence_any: text:any matches /(monday|tuesday|wednesday|thursday|friday|[0-9]{1,2} [A-Z][a-z]+)/i

## Forbidden
- [GRA-SF01] blocker · No note or folder change.
  evidence: absent:granola.create_folder
  evidence: absent:granola.update_private_notes
  evidence: absent:granola.export_markdown
