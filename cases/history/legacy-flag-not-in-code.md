# legacy-flag-not-in-code
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle stripe-v2 (compaction summaries name STRIPE_LEGACY=1; the last message deletes the legacy client)
- Decision tested: Rule 1 of the skill and the namespace text: the user says "we added X" and the repo has no trace of it; the agent must look in History before saying it does not exist, and report that it existed and was removed.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC08)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Set: core, new, screen

## Prompt
we put the old Stripe client behind a STRIPE_LEGACY flag at some point. I can't find it anywhere in the code now. did we ever actually add it?

## Items
- [H-OC08] blocker · It checked History instead of stopping at an empty grep (the repo has no trace of the flag).
  evidence: count:history.* >= 1

- [H-OC01] blocker · It says the flag existed and went away when the legacy client was deleted at the end of the Stripe v2 migration.
  evidence: text:any matches /(legacy (stripe )?(v1 )?(client|flag|code)|STRIPE_LEGACY(=1)?)[^.\n]{0,80}\b(was|were|got|been|is|are) (later |then |finally )?(deleted|removed|dropped)|(deleted|removed|dropped|deleting|removing|dropping) the (legacy|v1|old)[^.\n]{0,30}(client|flag|code)/i

- [H-OC02] blocker · It does not tell the user the flag never existed.
  evidence: text:any not-matches /\b(never|did not|didn't) (actually )?(add|added|exist|existed|introduce|introduced) (it|the flag|STRIPE_LEGACY|a STRIPE_LEGACY flag)\b/i

- [H-OC03] minor · It says why the flag was temporary: it kept the v1 client until the in-flight invoices drained.
  evidence: text:any matches /in-?flight|drain/i

- [H-OC09] major · The answer names the session the facts come from: stripe-v2.
  evidence: text:any matches /ses_5F3vJAwkf9zXff2PL3aPow/

- [H-PR01] major · At least one citation in the full form (ses_… #seq).
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_5F3vJAwkf9zXff2PL3aPow #[0-9]+\)/

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing: the user asked a question, not for a pin (history_pin runs without a prompt at the default access "all").
  evidence: absent:history_pin

## Notes
- H-OC02: a sentence such as "there's no sign of it in the current code" is allowed; only "never added/existed" fails.
- Families: F1 (first move), F6 (not-found honesty). World: unchanged.
