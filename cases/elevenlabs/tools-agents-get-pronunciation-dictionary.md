# tools-agents-get-pronunciation-dictionary
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wave sweep: agents_get_pronunciation_dictionary (a dictionary's rules)
- Decision tested: A dictionary-rules question reads the dictionary once by id
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the rules in pronunciation dictionary pd_000000000000000000000000.

## Items
- [ELV-TR01] blocker · It used agents_get_pronunciation_dictionary once.
  evidence: call:elevenlabs.agents_get_pronunciation_dictionary#1
- [ELV-PR01] major · It read the dictionary the user named.
  evidence: call:elevenlabs.agents_get_pronunciation_dictionary#1 args.pronunciation_dictionary_id == "pd_000000000000000000000000"
- [ELV-OC02] major · It says the object was not found, and invents nothing.
  evidence: text:any matches /(not found|couldn't find|could not find|no such|doesn't exist|does not exist|404|no (dictionary|guide|set|task|call|chat|email|opportunity|field|company|person))/i
- [ELV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
