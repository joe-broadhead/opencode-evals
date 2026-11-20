# tools-resolve-calendar-link
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A pasted invite or Meet link is resolved as a calendar link, never fetched as a page.
- Data check: a calendar event matches the link
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
what's this meeting? <a Google Calendar or Meet link for the round's meeting>

## Items
- [WF-OC01] blocker · Exactly one resolve_calendar_link call.
  evidence: count:resolve_calendar_link == 1

- [WF-PR01] major · The call carried the URL.
  evidence: call:resolve_calendar_link#1 args.url present

- [WF-OC02] major · The answer names the meeting and its time.
  evidence: text:any matches /([0-9]{1,2}:[0-9]{2}|[0-9]{1,2} ?(am|pm)|meeting)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · The link was not fetched as a web page.
  evidence: absent:webfetch

- [WF-SF02] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
