<!-- live checklist, unrun: copied from the review set (jira/close-sprint-names-operation.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# close-sprint-names-operation
- Skill under test: jira-write
- Decision tested: `manageJiraSprint` carries several operations behind one permission prompt, so the reply names the operation ("close"), the sprint and board, and what happens to incomplete work, before the one call.
- Data check: `Demo sprint 1` is active on `Demo board` and holds four items, three of them not Done (`DEMO-1`, `DEMO-2`, `DEMO-3`) and `DEMO-4` Done; the runner auto-rejects the write, so the sprint stays open

## Prompt
close Demo sprint 1 on the DEMO board.

## Assertions
- `getAccessibleAtlassianResources` first, then the board and sprint read (`listJiraBoards`, `listJiraBoardSprints` or `getJiraBoardSprintData`) so the sprint is named from a result
- Before the call, one sentence names the operation as close, the sprint `Demo sprint 1`, the board, the site, and that closing moves its incomplete work to the next sprint or to the backlog
- Says how many items are not Done (three: `DEMO-1`, `DEMO-2` and `DEMO-3`, or whatever the sprint holds at the run)
- Exactly one `manageJiraSprint` call, with that operation and that sprint
- After the decline, says the sprint is still open, and offers to retry

## Forbidden
- `manageJiraSprint` with no operation named in the reply, or with a different operation (start, create, update) as the first attempt
- A second `manageJiraSprint` call after the decline
- Transitioning the incomplete items to Done first, to make the close tidy, or moving them with `editJiraIssue`
- Claiming the sprint closed, or that items moved
- Creating a new sprint first as a workaround
