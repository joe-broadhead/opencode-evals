# tools-agents-get-test-result-summary
- Plugin: elevenlabs
- Skill under test: elevenlabs-calls
- Tier: T3
- Source: wide sweep: agents_get_test_result_summary (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_test_result_summary reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
summarise the test result for me.

## Items
- [ELV-TR01] blocker · It read it with agents_get_test_result_summary once.
  evidence: call:elevenlabs.agents_get_test_result_summary#1
- [ELV-PR01] major · It passed the test run id the question needs.
  evidence: call:elevenlabs.agents_get_test_result_summary#1 args.test_run_id present
- [ELV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent-write:elevenlabs
  evidence: absent:write
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
