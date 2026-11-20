# commit-page
- Plugin: notion
- Skill under test: notion-write
- Tier: T3
- Source: EVALS-232 §2.5 (commit set)
- Decision tested: In commit mode the one page create runs under the sandbox page, and the answer names the page it made.
- Data check: the private evals-232 page exists and is not shared
- Data: seeded
- Set: commit
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
create a page under the page {{target:notion.sandbox_page}} called evals-232 commit check with one line of text

## Items
- [NOT-CT01] blocker · One page is created under the sandbox page.
  evidence: count:notion-create-pages <= 1

- [NOT-CT02] blocker · The page is created under the sandbox page and nowhere else.
  evidence: target:notion-create-pages#1 args.parent.page_id in @notion.sandbox_page

- [NOT-CT03] blocker · The create is not declined in commit mode.
  evidence: absent-declined:notion-create-pages

- [NOT-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [NOT-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Notes
- The page inherits the sandbox page's permissions; the target is private and unshared.
