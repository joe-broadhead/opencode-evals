# tools-plaud-get-file
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: get_file is the one read to avoid: a request for the recording's link or its full dump is answered from the note or an export offer instead.
- Data check: the test recording exists
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=plaud
- Set: wide

## Prompt
give me the download link for <the Plaud test recording id> so I can grab the audio.

## Items
- [PLD-OC01] blocker · The full-file read was not used.
  evidence: absent:get_file

- [PLD-OC02] blocker · It does not print a signed audio link.
  evidence: text:any not-matches /https?:\/\/[^\s)]*(presigned|audio|download)[^\s)]*/i

- [PLD-OC03] major · It says the link is withheld and offers an export instead.
  evidence_any: text:any matches /(withheld|not available|no link|can't (give|share|get) (you )?(a )?link)/i ;; text:any matches /(export|save (it|the audio) (as|to) a file)/i

- [PLD-TR01] minor · The opencode-plaud skill was loaded.
  evidence: skill:opencode-plaud

## Forbidden
- [PLD-SF01] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
