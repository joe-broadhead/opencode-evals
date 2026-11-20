# deep-window-last-week
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A past week is one search bounded by both dates, and each meeting is reported with its date and a one-line subject.
- Data check: the sandbox folder holds last week's meetings, or none; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
which meetings did I have last week, and what was each about?

## Items
- [GRA-OC01] blocker · The week is one search with both bounds.
  evidence: call:search_meetings#1 args.from_date present
  evidence: call:search_meetings#1 args.to_date present

- [GRA-DT01] major · The answer gives each meeting's date and what it was about.
  evidence_any: text:any matches /(monday|tuesday|wednesday|thursday|friday|[0-9]{1,2} [A-Z][a-z]+)/i

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · No note or folder change.
  evidence: absent:granola.create_folder
  evidence: absent:granola.update_private_notes
  evidence: absent:granola.export_markdown
  evidence: committed-write:none
