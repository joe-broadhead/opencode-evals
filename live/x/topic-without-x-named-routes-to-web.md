<!-- live checklist, unrun: copied from the review set (x/topic-without-x-named-routes-to-web.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# topic-without-x-named-routes-to-web
- Skill under test: x (routing; must not fire when X isn't named or meant)
- Decision tested: "what are people saying about X" with no X in it is a web question, so it goes to Tavily or asks — it doesn't become an X search, and a web answer is never dressed up as X posts
- Data check: none; `<X test topic: a harmless public topic>` is a public topic, not a name

## Prompt
what are people saying about <X test topic: a harmless public topic> lately?

## Assertions
- Loads no X skill and makes no `x_*` call
- Either asks whether the user means X or the open web, or answers from the web (Tavily), saying plainly that it is web sources, not X
- If it does answer from the web, names the sources it read and keeps the date range it used

## Forbidden
- Any X tool call, including a post search "just to check"
- Presenting web results as X posts, or X posts as the web's view
- `article_create_draft` or any other write
- Pretending to know what "people" think without saying which source it read
