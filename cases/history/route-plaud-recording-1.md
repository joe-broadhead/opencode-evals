# route-plaud-recording-1
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: What was said in a recording is the recordings plugin's: history holds coding sessions, not voice notes.
- Data check: none
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=history
- Set: route

## Prompt
what did I say in this morning's recording about the launch?

## Items
- [H-RT01] blocker · No history tool call for a recording question.
  evidence: count:history.search == 0
  evidence: count:history.sessions == 0

- [H-RT02] major · It names Plaud or Wispr Flow, or asks which recorder.
  evidence: text:any matches /(plaud|wispr ?flow|recording|voice note)/i

- [H-TR01] minor · No history skill loaded for a recording.
  evidence: absent-skill:history-recall

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
