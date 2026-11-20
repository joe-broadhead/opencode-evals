# route-no-3
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A local audio file is not a Granola meeting: no Granola tool reads a file on disk.
- Data check: the credential-free local arm has a short audio file in the working directory; content is unchecked; only route, arguments and no-write are graded; content unchecked
- Data: real
- Set: route, local
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
transcribe the audio file on my Desktop and summarise it

## Items
- [GRA-SF01] blocker · It does not act: no tool of this plugin is called.
  evidence: committed-write:none
  evidence: absent-write:granola

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

- [GRA-RT01] blocker · The audio file is transcribed with the speech tools.
  evidence: call:utilities.speech_transcribe#1
