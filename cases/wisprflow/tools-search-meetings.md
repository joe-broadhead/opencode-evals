# tools-search-meetings
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: Meetings by topic are one search_meetings call with a window, not a walk of every meeting.
- Data check: synthetic: the round's Wispr Flow meeting (owner row 25) exists, with a transcript and a summary
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
find my meetings about pricing from the last month.

## Items
- [WF-OC01] blocker · At most two search_meetings calls.
  evidence: count:search_meetings >= 1
  evidence: count:search_meetings <= 2

- [WF-OC02] major · The search carries the topic and a window.
  evidence: call:search_meetings#1 args.query present

- [WF-OC03] major · The answer lists the meetings with dates and links.
  evidence: text:any matches /(notes\.wisprflow\.ai|[0-9]{1,2} (Oct|Nov|October|November))/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
