# tools-get-participant-contacts
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A person's job title and company come from get_participant_contacts, only because the user asked about those details.
- Data check: the participant has a contact record
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
what does the person in my last Wispr Flow meeting do, and which company are they at?

## Items
- [WF-OC01] blocker · Exactly one get_participant_contacts call.
  evidence: count:get_participant_contacts == 1

- [WF-PR01] major · The contact id the user gave was passed.
  evidence: call:get_participant_contacts#1 args.contact_ids present

- [WF-OC02] major · The answer gives a role and a company, and says it looked the profile up.
  evidence: text:any matches /(looked up|Wispr Contacts|profile)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
