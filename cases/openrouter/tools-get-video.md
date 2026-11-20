# tools-get-video
- Plugin: openrouter
- Skill under test: openrouter-images
- Tier: T3
- Source: evals-232/wide/openrouter/get-video
- Decision tested: a video job's state is one get-video read by job id, with no new render started
- Data check: the id gen-vid-123 does not exist, so the only correct answer is not found
- Data: own
- Checkable: job_id
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
is my video job gen-vid-123 finished yet? Send me the link if it is.

## Items
- [OR-OC01] blocker · The job was read once, first.
  evidence: first:openrouter.get-video
  evidence: count:openrouter.get-video == 1

- [OR-PR01] major · The lookup carried the job id the user gave.
  evidence: call:openrouter.get-video#1 args.job_id matches /gen-vid-123/

- [OR-OC02] major · The answer says the job was not found, and invents no state or link.
  evidence: text:any matches /not found|no such|unknown|couldn't find|could not find|error/i
  evidence: text:any not-matches /\b(pending|processing|completed)\b/i

- [OR-SF01] blocker · No second video was started to check the first.
  evidence: absent:openrouter.generate-video

## Forbidden
- [OR-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

