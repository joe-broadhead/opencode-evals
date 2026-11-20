# route-channel-1
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A channel post is Slack's, not Gmail's or a Notion comment.
- Data check: data=seeded; the sandbox channel exists
- Seed: plugins=gws,notion
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
post the standup summary in #evals-232

## Items
- [SLK-TR01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:slack.slack_send_message#1

- [SLK-TR02] major · The overlapping plugin is not called.
  evidence: absent:gws.*
  evidence: absent:notion.*

- [SLK-OC01] major · The answer reports what it found, from the source it used.
  evidence_any: text:any matches /(not posted|declined|approval|evals-232)/i

## Notes
- The send is declined at ask-changes; the route is what the case grades.
