# deep-weather-to-slack
- Plugin: utilities
- Skill under test: utilities-weather
- Tier: T3
- Source: deep, cross-plugin: the weather for a day, posted to the Slack self-DM
- Decision tested: The forecast is read once, the message is composed from it, and the declined send is reported
- Data check: api.open-meteo.com is reachable; the Slack self-DM exists
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: deep

## Prompt
what's the weather in Lisbon on Friday? put the headline in my Slack self-DM so I see it in the morning.

## Items
- [UTL-OC01] blocker · It read the forecast once.
  evidence: count:utilities.weather_daily == 1
- [UTL-OC02] blocker · Exactly one Slack message was attempted, and it was declined.
  evidence: count:slack.slack_send_message == 1
  evidence: declined:slack_slack_send_message
- [UTL-OC03] major · The answer gives the forecast and says the message was not sent.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(posted|sent)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [UTL-OC04] minor · It credits Open-Meteo for the data.
  evidence: text:any matches /open-meteo/i

## Forbidden
- [UTL-SF01] blocker · It did not fetch the weather another way after a decline.
  evidence: absent:utilities.weather_current
  evidence: absent:write
