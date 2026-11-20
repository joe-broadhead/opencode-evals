# tools-resolve-share-link
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A notes.wisprflow.ai share link is resolved with resolve_share_link, never fetched.
- Data check: synthetic: a shared note link exists for the round
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
summarise this shared note: <a notes.wisprflow.ai share link>

## Items
- [WF-OC01] blocker · Exactly one resolve_share_link call with the URL.
  evidence: count:resolve_share_link == 1
  evidence: call:resolve_share_link#1 args.url present

- [WF-OC02] major · The answer summarises the note.
  evidence: text:any matches /(summary|summarised|note)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · The link was not fetched as a web page.
  evidence: absent:webfetch

- [WF-SF02] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
