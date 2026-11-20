# route-no-3
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: should-not-call: account help has no tool
- Decision tested: A how-do-I-change-my-password question reaches no Metaview tool
- Data check: none
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: route

## Prompt
how do I change my Metaview password?

## Items
- [MV-RL01] blocker · No Metaview tool was called.
  evidence: absent:metaview.*
- [MV-OC01] major · The answer points at Metaview's own account settings.
  evidence: text:any matches /(settings|account|Metaview|password)/i
