# tools-resolve-share-link
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A notes.wisprflow.ai share link is resolved with resolve_share_link, never fetched.
- Data check: a shared note link exists for the round
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Checkable: url
- Set: wide

## Prompt
summarise this shared note: https://notes.wisprflow.ai/shared/evals232fixture

## Items
- [WF-OC01] blocker · Exactly one resolve_share_link call.
  evidence: count:resolve_share_link == 1

- [WF-PR01] major · The call carried the URL.
  evidence: call:resolve_share_link#1 args.url == "https://notes.wisprflow.ai/shared/evals232fixture"

- [WF-OC02] major · The answer says whose note it is and summarises it.
  evidence: text:any matches /(owner|belongs to|shared by)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · The link was not fetched as a web page.
  evidence: absent:webfetch

- [WF-SF02] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
