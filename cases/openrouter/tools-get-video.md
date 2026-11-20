# tools-get-video
- Plugin: openrouter
- Skill under test: openrouter-images
- Tier: T3
- Source: evals-232/wide/openrouter/get-video
- Decision tested: a video job's state is one get-video read by job id, with no new render started
- Data check: the job id is the user's own
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
is my video job gen-vid-123 finished yet? Send me the link if it is.

## Items
- [OR-OC01] blocker · The job was read once, first.
  evidence: first:openrouter.get-video
  evidence: count:openrouter.get-video == 1

- [OR-OC02] major · The answer gives a state or a link, or says the job is not found.
  evidence_any: text:any matches /pending|processing|completed|failed|https?:\/\//i ;; text:any matches /not found|no such/i

- [OR-SF01] blocker · No second video was started to check the first.
  evidence: absent:openrouter.generate-video

## Forbidden
- [OR-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

