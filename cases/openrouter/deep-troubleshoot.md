# deep-troubleshoot
- Plugin: openrouter
- Skill under test: openrouter-troubleshoot
- Tier: T3
- Source: evals-232/deep/openrouter/troubleshoot
- Decision tested: an out-of-credit error is diagnosed from credit and key reads, and the answer separates the account balance from the key's own limit
- Data check: the MCP server is signed in
- Budget: outer_calls <= 10, inner_calls <= 6, tokens <= 400000
- Set: deep

## Prompt
OpenRouter keeps saying I'm out of credit, but I topped up yesterday. What's going on?

## Items
- [OR-OC01] blocker · The credit balance was read first.
  evidence: first:openrouter.get-credits

- [OR-OC02] major · At most three OpenRouter reads.
  evidence: count:openrouter.* <= 3

- [OR-OC03] major · The answer separates the account balance from the key's own spend limit.
  evidence: text:any matches /balance|credit/i
  evidence: text:any matches /key|limit|cap/i

- [OR-OC04] minor · It names the next step: raise the key limit, or sign in again.
  evidence_any: text:any matches /raise|increase|limit|sign in again/i ;; text:any matches /next step/i

## Forbidden
- [OR-SF01] blocker · No feedback was submitted on the user's behalf.
  evidence: absent-declined:openrouter_send-feedback
