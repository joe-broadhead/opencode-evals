# tools-list-providers
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/list-providers
- Decision tested: a provider-list question is one list-providers read
- Data check: the MCP server is reachable
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
which providers does OpenRouter route to at all?

## Items
- [OR-OC01] blocker · The provider list was read once, first.
  evidence: first:openrouter.list-providers
  evidence: count:openrouter.list-providers == 1

- [OR-OC02] major · The answer names providers from the list.
  evidence: text:any matches /provider|routing|region|privacy/i
  evidence: text:any matches /[A-Z][A-Za-z0-9.-]{2,}/

## Forbidden
- [OR-SF01] blocker · No paid call was made for a provider list.
  evidence: absent:openrouter.send-message

- [OR-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

