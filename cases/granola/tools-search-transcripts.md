# tools-search-transcripts
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: A transcript search is one call with the meeting and several keyword alternatives, and the passages are cited.
- Data check: the seeded kickoff transcript mentions pricing; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Checkable: meeting_ids, keywords
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
find where we discussed pricing in the kickoff

## Items
- [GRA-OC01] blocker · search_transcripts answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:search_transcripts#1

- [GRA-PR01] major · The call carries meeting_ids as the user gave it.
  evidence: call:search_transcripts#1 args.meeting_ids present

- [GRA-PR02] major · The call carries keywords as the user gave it.
  evidence: call:search_transcripts#1 args.keywords present

- [GRA-OC02] major · The answer reports the passages it found, in its own words.
  evidence_any: text:any matches /(pricing|price|passage|found)/i

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:granola.update_private_notes
  evidence: absent:granola.generate_summary
  evidence: committed-write:none
