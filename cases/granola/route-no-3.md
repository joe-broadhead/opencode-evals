# route-no-3
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A local audio file is not a Granola meeting: no Granola tool reads a file on disk.
- Data check: the credential-free local arm has a short audio file in the working directory; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Set: route, local
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
transcribe the audio file on my Desktop and summarise it

## Items
- [GRA-SF01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:granola.*
  evidence: committed-write:none

- [GRA-OC01] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(local|file|desktop|audio|transcri)/i

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean
