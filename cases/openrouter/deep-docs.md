# deep-docs
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/deep/openrouter/docs
- Decision tested: an integration question is answered from OpenRouter's docs, with the link and the request shape the docs returned
- Data check: the docs index answers for image input
- Data: own
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: deep

## Prompt
how do I send an image to a vision model through the OpenRouter API? Show me the request body.

## Items
- [OR-OC01] blocker · The docs were searched first.
  evidence: first:openrouter.search-docs

- [OR-OC02] major · The answer links OpenRouter documentation.
  evidence: text:any matches /openrouter\.ai\/docs|docs\.openrouter\.ai/i

- [OR-OC03] major · It shows a request body with an image part.
  evidence: text:any matches /image_url|input_image|content/i
  evidence: text:any matches /messages|model|base64|https?:\/\//i

- [OR-OC04] minor · It does not present an unverified field as ready to use.
  evidence: text:any matches /docs (say|show)|per the docs|verify/i

## Forbidden
- [OR-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

