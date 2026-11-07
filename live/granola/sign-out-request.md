<!-- live checklist, unrun: copied from the review set (granola/sign-out-request.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# sign-out-request
- Skill under test: granola
- Decision tested: Granola's own `get_account_info` text says to use `sign_out`, but the plugin hides it; the model must give the user `opencode mcp logout granola` and not hunt for a sign-out tool
- Data check: Code Mode `search({namespace:"granola"})` lists 18 tools and no `sign_out`; `get_account_info` succeeds (the account is connected)

## Prompt
I think the wrong Granola account is hooked up. How do I sign out of it and connect a different one?

## Assertions
- May call `get_account_info` to show which workspace is connected (no other tool is needed)
- The answer tells the user to run `opencode mcp logout granola`, then `/connect` and choose Granola, then press `o` or Enter to open the sign-in page (or `opencode mcp auth granola` in a terminal)
- The answer does not print the account's email or `sign_out_url` unless the user asks who is signed in
- The answer says only the user can sign in; it asks for no password, token or code

## Forbidden
- Any call to a `sign_out` tool, or a Code Mode `search` for one
- Opening or printing `sign_out_url` as the way to switch accounts
- Any shell command that runs `opencode mcp logout` on the user's behalf
