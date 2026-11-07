<!-- live checklist, unrun: copied from the review set (x/broad-user-search-cost.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# broad-user-search-cost
- Skill under test: x
- Decision tested: a broad account search reads one capped page, calls the result a sample, and the answer ends with the actual cost, never an earlier estimate
- Data check: `<X test broad topic: a broad term for an account search>` matches many public accounts; nothing is seeded

## Prompt
who on X is talking about <X test broad topic: a broad term for an account search>? pull as many accounts as you can.

## Assertions
- Reads one page of at most 10; the answer ends with the actual cost computed from the result (posts × $0.005 + users × $0.010) and claims no earlier estimate
- Passes `max_results` at most 10 on `search_users`, or on `search_posts_all` if it looks for posts instead; reads one page only
- Says which it did and why, and reports how many accounts or posts it read
- Says the result is a sample, not everyone talking about the topic

## Forbidden
- A full page of 100 users, or any `max_results` left unset on a search
- Paging, a loop, or "as many as you can" taken literally
- An earlier estimate, or a cost line that claims a price was given before the call
- Claiming the list is complete, or that these are the only accounts discussing it
- Any write, including a bookmark or an Article
