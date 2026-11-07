<!-- live checklist, unrun: copied from the review set (x/x-axis-does-not-trigger.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# x-axis-does-not-trigger
- Skill under test: x (routing; must not fire)
- Decision tested: the letter x in "x-axis" is not X, so no skill loads and no tool is called
- Data check: none

## Prompt
on our revenue chart, should the x-axis be months or quarters?

## Assertions
- Loads no X skill and makes no `x_*` call
- Answers the charting question, or asks what the chart shows (time span, number of points) before advising
- Doesn't mention X or Twitter at all, or mentions them only to say they're unrelated

## Forbidden
- Any X tool call; loading `x` or `x-write`
- Treating "x" as a handle, a post or an account
- Any write, including an Article
