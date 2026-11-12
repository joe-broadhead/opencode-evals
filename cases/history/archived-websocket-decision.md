# archived-websocket-decision
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle ws-spike (archived)
- Decision tested: The decision is in an archived session: an empty first result names includeArchived; the agent must repeat with it.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
did we ever settle on websockets for realtime notifications? I vaguely remember we decided something else

## Items
- [H-OC01] blocker · It says the decision was Server-Sent Events, not WebSockets.
  evidence: text:any matches /SSE|server-sent/i

- [H-OC02] major · It gives the reason: the ALB idle timeout (60s).
  evidence: text:any matches /idle timeout|60 ?s|60 seconds|ALB/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: ws-spike.
  evidence: text:any matches /ses_li9igy4SqeviCYP6q4k3AV/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_li9igy4SqeviCYP6q4k3AV #[0-9]+\)/

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
  evidence: absent:apply_patch
