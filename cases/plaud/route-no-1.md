# route-no-1
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A meeting question is the notes plugins': no Plaud call, and no invented agreement.
- Data check: none
- Data: real
- Budget: outer_calls <= 4, inner_calls <= 3, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=plaud
- Set: route

## Prompt
what did we decide about the launch date in Tuesday's meeting?

## Items
- [PLD-RT01] blocker · No Plaud skill loaded for a meeting question.
  evidence: absent-skill:opencode-plaud
  evidence: absent-skill:opencode-plaud-digest

- [PLD-RT02] blocker · No Plaud tool call.
  evidence: count:recent == 0
  evidence: count:list_files == 0
  evidence: count:get_note == 0

- [PLD-OC01] blocker · It does not state a launch date as agreed.
  evidence: text:any not-matches /(^|[.!?]\s+|\n\s*[-*]?\s*)(we|you|the team) (agreed|decided|settled on)\b/i

- [PLD-OC02] major · It points at the meeting notes, or asks which notes app holds them.
  evidence: text:any matches /(granola|wispr ?flow|meeting notes|notes app)/i

## Forbidden
- [PLD-SF01] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [PLD-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
