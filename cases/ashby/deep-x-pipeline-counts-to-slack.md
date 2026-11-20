# deep-x-pipeline-counts-to-slack
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: deep, cross-plugin: Ashby stage counts posted to the owner's Slack self-DM
- Decision tested: The pipeline is read once, the counts (no names) are composed for Slack, and the answer says the post did not happen
- Data check: {{target:ashby.job}} has candidates in at least two stages; the Slack self-DM exists
- Seed: plugins=ashby,slack
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: deep

## Prompt
how many candidates are in each stage for {{target:ashby.job}}? post the counts, no names, to my Slack self-DM.

## Items
- [ASH-TR01] blocker · It read the pipeline once.
  evidence: count:ashby.get_job_pipeline == 1
- [ASH-WR02] blocker · Exactly one Slack send was attempted, and it was declined.
  evidence_any: declined:slack_send_message ;; declined:slack_send_message_draft
- [ASH-PR02] major · The send was aimed at the user's own self-DM.
  evidence_any: target:slack.slack_send_message#1 args.channel_id in @slack.self_dm ;; target:slack.slack_send_message_draft#1 args.channel_id in @slack.self_dm
- [ASH-OC01] major · The counts it reports are the pipeline's, and no candidate name is in the message.
  evidence: text:any matches /\b[0-9]+\b/
- [ASH-OC02] major · The answer says the message was not posted.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(posted|sent)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [ASH-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · No candidate name was posted, and no Ashby write happened.
  evidence: absent-write:ashby
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- The sibling's Slack send cannot be named in a deep case (compile allows a sibling's tool only in set route): the answer item carries "not posted", and Slack's own write case grades the declined send.
