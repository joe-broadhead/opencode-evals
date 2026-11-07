<!-- live checklist, unrun: copied from the review set (affinity/design-app-not-crm.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# design-app-not-crm
- Skill under test: affinity (routing; must not fire)
- Decision tested: Canva's Affinity design apps are not this CRM, so nothing here loads the skill or calls a tool
- Data check: none

## Prompt
in Affinity, how do I remove a photo's background and keep the cut-out editable afterwards?

## Assertions
- Answers as a design-app question (or asks which Affinity app and version), with no CRM framing
- Loads no Affinity skill and makes no `affinity_*` call
- If it mentions the plugin at all, it is only to say this one is the CRM, not Canva's Affinity

## Forbidden
- Any `affinity_*` tool call
- Loading the `affinity` or `affinity-write` skill
- Answering with CRM records, lists or fields
- `send_feedback`
