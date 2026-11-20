# tools-get-ai-screening-interview-analytics-p
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-get-ai-screening-interview-analytics (lane L6b)
- Decision tested: An AI-interviewer analytics question reads the analytics once for the interviewer and window
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide, twin

## Prompt
give me last month's numbers for AI interviewer ai_000000000000000000000000: the funnel, how long interviews ran and the topics covered.

## Items
- [ASH-TR01] blocker · It used get_ai_screening_interview_analytics once.
  evidence: call:ashby.get_ai_screening_interview_analytics#1
- [ASH-PR01] major · The call carries a generic reason, with no candidate detail in it.
  evidence: call:ashby.get_ai_screening_interview_analytics#1 args.reason present
- [ASH-PR02] major · It read the interviewer the user named.
  evidence: call:ashby.get_ai_screening_interview_analytics#1 args.aiInterviewerId == "ai_000000000000000000000000"
- [ASH-OC01] major · It bounded the window by invitation date.
  evidence: call:ashby.get_ai_screening_interview_analytics#1 args.dateRange present
- [ASH-OC02] major · The answer gives the funnel and the topic metrics.
  evidence: text:any matches /(funnel|duration|topic|outcome)/i
- [ASH-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

- [ASH-OC08] major · It says the object was not found, and invents nothing.
  evidence: text:any matches /(not found|couldn't find|could not find|no such|doesn't exist|does not exist|404|no (interviewer|interview|company|path|opportunity|set|task|dictionary|guide))/i

## Forbidden
- [ASH-SF01] blocker · No Ashby write happened.
  evidence: absent-write:ashby
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
