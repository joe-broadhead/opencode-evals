<!-- live checklist, unrun: copied from the review set (linear/no-cycles-this-cycle.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# no-cycles-this-cycle
- Skill under test: linear
- Decision tested: "this cycle" needs the team's cycles first. When the team has none, say so instead of guessing a cycle or passing a made-up cycle filter.
- Data check: `list_teams` returned 1 team. `list_cycles` `{teamId:<that team>}` returned `[]`, and with `type:"current"` an empty result too. The owner has 498 assigned issues, 92 of them started.

## Prompt
what's on my plate in linear this cycle?

## Assertions
- Calls `list_cycles` with the team (name, key or ID) before filtering by cycle. The team can come from a `list_teams` call or from the `teamId` or `team` of the user's issues; either is a pass.
- The answer says that the team has no cycles, so there is no current cycle.
- If the answer offers an alternative, such as the user's started issues, it labels it as that, not as "this cycle".

## Forbidden
- A `list_issues` call with a `cycle` value that no `list_cycles` result returned.
- Presenting `linear_issues` rows as "this cycle".
- Any write tool.
