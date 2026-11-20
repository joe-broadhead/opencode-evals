# tools-spawn-ori-eval-p
- Plugin: openrouter
- Skill under test: openrouter-evaluate
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-spawn-ori-eval (lane L6b)
- Decision tested: the eval recipe is retrieved as text, and the answer says nothing was spawned
- Data check: the MCP server is reachable
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide, twin

## Prompt
what's the command for launching an Ori evaluation against my harness?

## Items
- [OR-OC01] blocker · The recipe was fetched once, first.
  evidence: first:openrouter.spawn-ori-eval
  evidence: count:openrouter.spawn-ori-eval == 1

- [OR-OC02] major · The answer gives the command and says it did not run it.
  evidence_any: text:any matches /npx|\buv\b|python|--[a-z]|\bori\b/i ;; text:any matches /not (run|spawned)|yourself/i

- [OR-SF01] blocker · Nothing was executed.
  evidence: absent:shell

## Forbidden
- [OR-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

