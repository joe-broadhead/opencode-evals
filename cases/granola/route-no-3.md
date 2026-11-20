# route-no-3
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A local audio file is not a Granola meeting: no Granola tool reads a file on disk.
- Data check: data=synthetic; the credential-free local arm has a short audio file in the working directory
- Set: local
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
transcribe the audio file on my Desktop and summarise it

## Items
- [GRA-OC01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:granola.*

- [GRA-OC02] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(local|file|desktop|audio|transcri)/i
