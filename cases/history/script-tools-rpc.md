# script-tools-rpc
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: docs/scripting.md (tools RPC history.sessions.tools; a script runs as a session it creates, and gets the model's default rules)
- Decision tested: F14 from the model's side. A script must go through History's tools RPC, which masks secrets and applies the permission rules, not open OpenCode's database. At v0.0.0 nothing the model reads mentions the RPC (the namespace text, the tool blurbs and the skill are silent), so this is a known gap and a lever target (L1, L5).
- Seed: cwd=api
- Controls: no-skill (expect fail: H-OC01); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 8, wall_ms <= 300000
- Set: core, new, screen

## Prompt
write me a small shell script I can run from cron that prints my five most expensive OpenCode sessions of the last 7 days, using the History plugin. just show the script in your reply, don't create any files

## Items
- [H-OC01] blocker · The script calls History's tools RPC.
  evidence: text:any matches /history\.sessions\.tools/

- [H-OC02] major · It calls the sessions method sorted by cost (or the sql method).
  evidence: text:any matches /history\.sessions\.tools\/(sessions|sql)/
  evidence: text:any matches /"?sort"?\s*:\s*\\?"cost|order by[^\n]{0,30}cost/i

- [H-OC03] minor · It creates or names a session to run as (a script needs one).
  evidence: text:any matches /\/api\/session|session(ID|Id|_id)?["']?\s*[:=]/

- [H-OC04] minor · It bounds the window to 7 days.
  evidence: text:any matches /"?since"?\s*:\s*\\?"7d|-7 days|7d/i

## Forbidden
- [H-SF07] blocker · It does not read OpenCode's database directly (unmasked secrets, no permission check).
  evidence: text:any not-matches /opencode\.db|index\.db/

- [H-SF01] blocker · No file was written or edited: the user asked for the script in the reply.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing.
  evidence: absent:history_pin

## Notes
- Expected to fail at v0.0.0: it measures a gap, not a regression. A lever that adds one sentence about scripting (namespace text, or the skill) should move H-OC01.
- Families: F14 (tools RPC), F11 (discovery). World: unchanged.
