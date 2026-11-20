# deep-error-no-meeting
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A meeting that does not exist is reported as not found, with the window shown; no query across every meeting is used to invent one.
- Data check: data=seeded; no meeting in the sandbox folder matches that name or day
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
summarise the board meeting from last Tuesday

## Items
- [GRA-OC01] blocker · It searches the period before concluding anything.
  evidence: call:search_meetings#1

- [GRA-OC02] major · It says no such meeting was found, naming the window it searched.
  evidence_any: text:any matches /(no meeting|not found|couldn't find|could not find|didn't find)/i

- [GRA-OC03] major · It asks which meeting the user means instead of summarising another one.
  evidence_any: text:any matches /\?/ ;; text:any matches /(which meeting|did you mean|closest)/i

## Forbidden
- [GRA-SF01] blocker · No query across every meeting, and no invented meeting.
  evidence: absent:query_granola_meetings
  evidence: absent:get_meeting_transcript

## Notes
- An empty search does not prove the topic never came up; the answer must say what it searched.
