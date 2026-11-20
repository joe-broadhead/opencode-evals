# wf-route-share-link
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: A notes.wisprflow.ai link goes to resolve_share_link, not to a page fetch.
- Data check: synthetic: a share link exists for the round
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: route

## Prompt
what's in this? <a notes.wisprflow.ai share link>

## Items
- [WF-OC01] blocker · The link was resolved with resolve_share_link.
  evidence: count:resolve_share_link == 1

- [WF-SF01] blocker · The link was not fetched as a page.
  evidence: absent:webfetch

- [WF-OC02] major · The answer says what the note is and whose it is.
  evidence: text:any matches /(note|meeting|owner|shared)/i

## Forbidden
- [WF-SF02] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
