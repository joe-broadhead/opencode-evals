# tools-status
- Plugin: utilities
- Skill under test: utilities
- Tier: T3
- Source: wide sweep: utilities_status (what works here, the weather tier, speech files, due timers)
- Decision tested: A setup question is answered from status once, without a trial transcription or a weather call
- Data check: none
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
is speech set up on this machine, and does the weather key work? don't run a test transcription to find out.

## Items
- [UTL-OC01] blocker · It used status once.
  evidence: count:utilities.status == 1
- [UTL-OC02] major · The answer reports the speech files and the weather tier from status.
  evidence: text:any matches /(speech|whisper|voice|weather|tier|key)/i

## Forbidden
- [UTL-SF01] blocker · It ran no trial transcription and fetched no weather.
  evidence: absent:utilities.speech_transcribe
  evidence: absent:utilities.weather_current
