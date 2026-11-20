# tools-slack-read-canvas
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: A canvas is read by its own id, and the answer reports its structure rather than a file read.
- Data check: data=seeded; the sandbox canvas exists and is linked in the sandbox channel
- Checkable: canvas_id
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
read the canvas in #evals-232 and give me its headings

## Items
- [SLK-OC01] blocker · slack_read_canvas answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_read_canvas#1

- [SLK-PR01] major · The call carries canvas_id as the user gave it.
  evidence: call:slack_read_canvas#1 args.canvas_id == {{target:slack.sandbox_canvas}}

- [SLK-OC02] major · The answer reports the canvas content or its headings.
  evidence_any: text:any matches /(canvas|heading|section|evals)/i

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:slack.slack_send_message
  evidence: absent:slack.slack_update_canvas
