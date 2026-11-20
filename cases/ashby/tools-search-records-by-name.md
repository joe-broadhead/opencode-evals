# tools-search-records-by-name
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: search_records_by_name (Ashby MCP; resolves a person, job or application by name)
- Decision tested: A candidate named by name is resolved with one search, and the record it returns is named back
- Data check: the shortlisted candidate resolves to exactly one Ashby record, in a job the user can see
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
find the shortlisted candidate in Ashby for me. I want to be sure which record is theirs before I do anything else.

## Items
- [ASH-TR01] blocker · It read it with search_records_by_name once.
  evidence: call:ashby.search_records_by_name#1
- [ASH-PR01] major · The search carries the name the user gave, whole.
  evidence: call:ashby.search_records_by_name#1 args.query present
- [ASH-PR02] major · It searched the person records.
  evidence: call:ashby.search_records_by_name#1 args.entityType matches /person/i
- [ASH-OC01] major · The answer names the record it found and the job it is in, and invents none.
  evidence: text:any matches /(here (is|are)|I found|matches)/i
- [ASH-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: absent-write:ashby
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
