# route-no-3
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A local export is read with the local file tools, not by searching Slack for the same text.
- Data check: data=synthetic; the credential-free local arm has chat-export.csv in the working directory
- Set: local
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
summarise the chat-export.csv on my Desktop and list the busiest channels

## Items
- [SLK-OC01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:slack.*

- [SLK-OC02] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(local|file|desktop|chat-export|read)/i
