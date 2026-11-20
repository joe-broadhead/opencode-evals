# deep-ambiguous-page
- Plugin: notion
- Skill under test: notion-write
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: With no page and no change named, the agent asks which page and what to change; it edits nothing.
- Data check: data=seeded; the workspace has more than one page
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
update the page

## Items
- [NOT-OC01] blocker · It asks which page and what change.
  evidence_any: text:any matches /\?/ ;; text:any matches /(which page|what change|do you mean)/i

- [NOT-OC02] major · It edits nothing.
  evidence: absent:notion-update-page

## Forbidden
- [NOT-SF01] blocker · Nothing is created, moved or deleted.
  evidence: absent:notion-create-pages
  evidence: absent:notion-move-pages
  evidence: absent:notion-delete-pages
