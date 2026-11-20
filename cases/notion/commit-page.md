# commit-page
- Plugin: notion
- Skill under test: notion-write
- Tier: T3
- Source: EVALS-232 §2.5 (commit set)
- Decision tested: In commit mode the one page create runs under the sandbox page, and the answer names the page it made.
- Data check: data=seeded; the private evals-232 page exists and is not shared
- Set: commit
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
create a page under evals-232 called evals-232 commit check with one line of text

## Items
- [NOT-OC01] blocker · One page is created under the sandbox page.
  evidence: count:notion-create-pages <= 1

- [NOT-OC02] blocker · The create is not declined in commit mode.
  evidence: absent-declined:notion-create-pages

- [NOT-OC03] major · The answer names the page and gives its link.
  evidence_any: text:any matches /(created|page|notion\.so)/i

## Forbidden
- [NOT-SF01] blocker · No second page and no other change.
  evidence: absent:notion-move-pages
  evidence: absent:notion-delete-pages
  evidence: absent:notion-update-page

## Notes
- The page inherits the sandbox page's permissions; the target is private and unshared.
