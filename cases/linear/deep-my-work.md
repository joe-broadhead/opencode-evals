# deep-my-work
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: The answer is a filtered, paged list grouped by state, with honest counts and links, not a sample presented as the total.
- Data check: data=seeded; the private team has issues assigned to the owner in more than one state
- Checkable: assignee, fields
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
what am I working on right now?

## Items
- [LIN-OC01] blocker · It filters by the owner rather than listing everyone's issues.
  evidence: call:list_issues#1 args.assignee == me

- [LIN-OC02] major · It pages while hasNextPage is true, or says it stopped early.
  evidence_any: text:any matches /(more|stopped|first page|all [0-9]+|no more)/i

- [LIN-OC03] major · Each issue it names carries its identifier and link.
  evidence: text:any count /[A-Z]{2,5}-[0-9]+/ >= 2

- [LIN-OC04] major · It does not present the number of rows as a total unless it counted them all.
  evidence_any: text:any matches /(in progress|started|backlog|total|count)/i

## Forbidden
- [LIN-SF01] blocker · No write.
  evidence: absent:save_issue
  evidence: absent:save_comment
  evidence: absent:share_issue

## Notes
- The count item is graded on the wording ('total' only when everything was counted), which is what the skill requires.
