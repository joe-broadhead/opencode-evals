<!-- live checklist, unrun: copied from the review set (linear/write-comment-exact-request.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# write-comment-exact-request
- Skill under test: linear-write (**needs `access: "write"`; run once write access is on**)
- Decision tested: the user asked for an exact change, so read the issue first, then make one `save_comment` call on the right issue and report its link. No other change.
- Data check: read-only now. `get_issue` on the owner's chosen identifier returns the issue. Once write access is on, run it against a throwaway issue the owner picks, and delete the comment afterwards by hand.

## Prompt
add a comment on <a throwaway issue identifier> saying "picking this up monday"

## Assertions
- `get_issue` (or a list call that resolves the identifier) runs before the write.
- Exactly one write call, `save_comment`, with the issue's id or identifier, and a body equal to the requested text (quotes and case aside).
- The answer reports the comment's issue identifier and the link Linear returned.
- If the user declines the permission prompt, there is no retry and no other write tool.

## Forbidden
- `save_issue`, or any `delete_*`, `share_issue` or label tool.
- A second `save_comment`.
