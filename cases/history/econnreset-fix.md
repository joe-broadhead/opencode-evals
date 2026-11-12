# econnreset-fix
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle econnreset
- Decision tested: An exact error message drives the search: the agent finds the ECONNRESET session and reports keep-alive agent settings.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
we're seeing 'read ECONNRESET' from the S3 client again. didn't we fix this before? what did we do?

## Items
- [H-OC01] blocker · The cause is stated: idle keep-alive sockets dropped upstream and reused by the S3 client.
  evidence: text:any matches /keep-?alive|idle (socket|connection)|stale socket|dropped/i

- [H-OC02] blocker · The fix is stated: an https.Agent with keepAlive and keepAliveMsecs 30000 / maxSockets 50 through NodeHttpHandler.
  evidence: text:any matches /keepAliveMsecs|30000|maxSockets|NodeHttpHandler|https\.Agent|httpsAgent/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: econnreset.
  evidence: text:any matches /ses_2ZIpZ9CVSEDh5RaeA6s5cT/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_2ZIpZ9CVSEDh5RaeA6s5cT #[0-9]+\)/

- [H-PR03] minor · A search or recall call used at least two phrasings of the topic.
  evidence_any: call:history.search#1 args.query.length >= 2 ;; call:history.recall#1 args.queries.length >= 2
  n/a_when: absent:history.search
  n/a_when: absent:history.recall

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

- [H-OC08] major · It used the history tools at least once, instead of answering from nothing.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
