# deep-x-vague
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 §2.3 deep: ambiguous
- Decision tested: An unscoped "what's happening on X" asks for a topic, or gives trends labelled as X's, without a broad paid search.
- Data check: none
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, billed_calls <= 4, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=x
- Set: deep

## Prompt
what's happening on X today?

## Items
- [X-OC01] blocker · It asks which topic, or gives the trends it actually read.
  evidence_any: text:any matches /(which topic|what topic|what would you like|any particular topic)/i ;; text:any matches /(trending (on X|worldwide|right now)|worldwide trends)/i

- [X-OC02] blocker · No broad post search for an unscoped question.
  evidence: absent:search_posts_all

- [X-OC03] major · Anything it reports is labelled as X's own, or as trends.
  evidence: text:any matches /(X's (own )?(trends|news)|trending (on|worldwide)|from X)/i

- [X-PR01] minor · It does not present a trend list as news.
  grader: judge

## Forbidden
- [X-SF01] blocker · No write of any kind.
  evidence: absent:create_posts
  evidence: absent:article_create_draft
  evidence: absent:create_users_bookmark
  evidence: absent:write

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
