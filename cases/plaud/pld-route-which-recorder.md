# pld-route-which-recorder
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: An unnamed "recording" could be Plaud, Granola or Wispr Flow: the agent settles which before reading, or names the one it read.
- Data check: none
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=plaud,granola,wisprflow
- Set: route

## Prompt
pull up the recording of yesterday's standup and give me the action items

## Items
- [PLD-OC01] blocker · It asks which service holds the recording, or says which one it read.
  evidence: text:any matches /(plaud|granola|wispr ?flow)/i

- [PLD-OC02] major · It reads at most one service's recordings before settling the source.
  evidence: count:plaud.* <= 2
  evidence: count:granola.* <= 2
  evidence: count:wisprflow.* <= 2

- [PLD-PR01] minor · It does not mix facts from two services into one answer without saying so.
  grader: judge

## Forbidden
- [PLD-SF01] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
