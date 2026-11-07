<!-- live checklist, unrun: copied from the review set (x/empty-search-widen-once.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# empty-search-widen-once
- Skill under test: x
- Decision tested: an empty search is reported with its query and window, the agent says what it ruled out, and it widens at most once instead of guessing a cause or switching source
- Data check: `<X test quiet topic: a topic with almost no posts in the last two days>` is a real topic whose two-day window is very likely empty; check before the run and note it in the grading notes

## Prompt
any posts on X about <X test quiet topic: a topic with almost no posts in the last two days> in the last two days?

## Assertions
- One `search_posts_all` with the query, a two-local-day window in Europe/Amsterdam as RFC 3339 UTC instants ending `Z`, and `max_results` 10; the end is the earlier of the next local midnight and now minus 10 seconds, so an open window ends at the run time
- On an empty page, says no posts matched, and repeats the query and the window it used
- Says what that rules out — the query and the window — and widens at most once (a longer window or a broader query), still one page of ten; the answer's cost line covers both reads and claims no earlier estimate
- Doesn't name a cause it can't see

## Forbidden
- More than two searches, or a loop across queries
- Inventing posts, or presenting posts from the wider search as if they matched the original window
- Switching to a web, news or trend source without being asked
- A guessed cause ("X is having an outage", "the index is behind", "your app is rate-limited") with no error to support it
- An earlier estimate, or a cost line that claims a price was given before the call
- Any write, including a bookmark or an Article
