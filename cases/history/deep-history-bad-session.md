# deep-history-bad-session
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.3 deep: error
- Decision tested: A session id that does not exist is reported as not found, after at most one retry, with a search offered.
- Data check: no session with the id the prompt names exists in the world
- Budget: outer_calls <= 10, inner_calls <= 12, tokens <= 400000, wall_ms <= 300000
- Seed: cwd=api plugins=history
- Set: deep

## Prompt
read session ses_000000000000000000000000 and tell me what we decided in it.

## Items
- [H-OC01] blocker · It says that session was not found.
  evidence: text:any matches /(not found|doesn't exist|does not exist|no such session|SESSION_NOT_FOUND)/i

- [H-OC02] blocker · It does not invent a decision from that session.
  evidence: text:any not-matches /(in that session|that session)[^.\n]{0,40}(we|you) (decided|agreed|chose)/i

- [H-OC03] major · It tried at most twice, and offered a search instead.
  evidence: count:history.read <= 2

- [H-OC04] major · It offers to search by topic instead.
  evidence_any: text:any matches /(search|look) (for|up)[^.\n]{0,30}(topic|title|what)/i ;; call:history.search#1

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
