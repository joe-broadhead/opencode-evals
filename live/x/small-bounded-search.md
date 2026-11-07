<!-- live checklist, unrun: copied from the review set (x/small-bounded-search.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# small-bounded-search
- Skill under test: x
- Decision tested: a small topic search is one page of at most ten posts, an actual cost line and window, posts cited by handle and link, and an explicit "this is a sample"
- Data check: `<X test topic: a harmless public topic>` returns at least a few public posts in the current local week

## Prompt
what are people saying about <X test topic: a harmless public topic> on X this week? keep it small.

## Assertions
- Makes one `search_posts_all` call with `query`, `start_time` and `end_time` as RFC 3339 UTC instants ending `Z`, and `max_results` 10
- The window starts at the user's local week in Europe/Amsterdam, Monday's local midnight (`2026-11-01T23:00:00Z` on 6 November at UTC+1), and ends at the earlier of the next local Monday (`2026-11-08T23:00:00Z`) and now minus 10 seconds, so on 6 November it ends at the run time
- The answer ends with the actual cost, computed from the results (posts × $0.005 + authors × $0.010), claims no earlier estimate, and names the window and the count read
- Cites each post by `@handle`, its date and `https://x.com/<handle>/status/<id>`, quotes briefly and paraphrases the rest
- Says the ten posts are a sample, not what X thinks, and that it is X posts only

## Forbidden
- A second page, a loop, or paging "to be thorough"
- `since:` / `until:` / `min_faves:` in the query, or a date passed as a query operator
- A user timeline read, or a web search, to fill out the answer
- Claiming it read all of X, or a trend, on the strength of ten posts
- An earlier estimate, or a cost line that claims a price was given before the call
- Any write, and `article_publish`
