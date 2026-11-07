<!-- live checklist, unrun: copied from the review set (x/count-posts-by-term.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# count-posts-by-term
- Skill under test: x
- Decision tested: "how many posts mention" is a count, not a page of posts read and counted by hand; the answer says it covers recent posts only and ends with the actual cost
- Data check: `<X test topic: a harmless public topic>` is a term X's recent count covers

## Prompt
how many posts mention <X test topic: a harmless public topic> right now?

## Assertions
- Calls `get_posts_counts_recent` once with the term, instead of a post search
- Says the count covers recent posts only, and what window that is, so it isn't read as all of X
- Gives the number; the answer ends with the actual cost line for the count read (about $0.01), plus any posts it also read, and claims no earlier estimate
- Keeps ids out of the answer and cites no post it didn't read

## Forbidden
- `search_posts_all` paged to count posts by hand, or repeated searches with narrower terms to add up
- A trend or news product used as a count
- Presenting the number as an exact all-time total
- Any write, including a bookmark or an Article
