# tools-get-note-template
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_note_template (one template's sections)
- Decision tested: A show-me-the-onsite-template question is one get_note_template by id
- Data check: the onsite note template exists
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
show me the onsite interview note template — what sections the interviewer fills in.

## Items
- [MV-TR01] blocker · It used get_note_template once.
  evidence: call:metaview.get_note_template#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_note_template#1 args.rationale present
- [MV-PR02] major · It read the template it resolved.
  evidence: call:metaview.get_note_template#1 args.template_id present
- [MV-OC01] major · The answer gives the sections.
  evidence: text:any matches /(section|template|question)/i
- [MV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
