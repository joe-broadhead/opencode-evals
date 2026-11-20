# deep-unavailable
- Plugin: browse
- Skill under test: browse
- Tier: T3
- Source: evals-232/deep/browse/unavailable
- Decision tested: a broken browser starts from the status read and names the real next step, with no reinstall loop and no invented diagnosis
- Data check: no browser server in the trial
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: deep

## Prompt
browse isn't working for me — nothing opens. Can you work out why?

## Items
- [BRW-OC01] blocker · The status read came first.
  evidence: first:browse.status

- [BRW-OC02] major · At most two browser reads, and no page action.
  evidence: count:browse.* <= 2

- [BRW-OC03] major · The answer names one next step from the status: install, pair or connect.
  evidence_any: text:any matches /browse-install|pair|extension|not installed|not connected/i ;; text:any matches /next step/i

- [BRW-SF01] blocker · No session was created to test it.
  evidence: absent:browse.session_new

- [BRW-EF01] minor · It did not tell the user to reinstall OpenCode or the plugin blindly.
  evidence: text:any not-matches /\breinstall\b.{0,20}\b(opencode|plugin)\b/i
