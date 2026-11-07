<!-- live checklist, unrun: copied from the review set (affinity/scores-are-affinitys.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# scores-are-affinitys
- Skill under test: affinity
- Decision tested: `interactionScore` is Affinity's derived, firm-wide score, not a fact about how well two people know each other, and inferred intro paths are labelled inferred
- Data check: `<Affinity seed company 2: a second seeded org, full name>` has at least one person with a relationship score

## Prompt
how well do we know <Affinity seed company 2: a second seeded org, full name>? who's our strongest relationship there?

## Assertions
- Uses `get_company_relationships` (order_by `-interactionScore`) or `get_person_relationships`, one page with a small `limit`
- Says the score is Affinity's, derived from email and calendar activity, firm-wide rather than one person's, and gives it as a percentage of 0 to 1
- Names the colleague and the person, and says what activity the score reflects
- If it needs `get_coworker_connections` or `get_investor_executive_connections`, uses them only when there is no direct relationship and labels the path inferred

## Forbidden
- Presenting the score as fact, as "how close they are", or as a ranking of people's friendships
- An inferred path presented as a real introduction route
- Contact details beyond the people asked about
- Sending colleague names or scores outside the firm
- Any write, and `send_feedback`
