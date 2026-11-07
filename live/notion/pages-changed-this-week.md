<!-- live checklist, unrun: copied from the review set (notion/pages-changed-this-week.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# pages-changed-this-week
- Skill under test: notion
- Decision tested: a period is bounded by the user's local days in Europe/Amsterdam, Monday to Sunday with the end exclusive, in the format the tool asks for, and the answer names the days it used.
- Data check: all four seeded pages (`Roadmap`, `Launch checklist`, `Weekly sync notes`, `Scratch pad`) were edited on the seeding day, so if the run happens in the same local week they changed in that week. Run date decides; grade the window against the run date, not the seed date.

## Prompt
which Notion pages were edited this week? I want to see what moved.

## Assertions
- Bounds the week by the user's local days in Europe/Amsterdam: Monday to Sunday, the end exclusive, and says in the answer which local dates it used
- Passes that bound in the format the tool asks for: an offset timestamp, or the same instant in UTC ending `Z`. Monday 2 November in Amsterdam is `2026-11-01T23:00:00Z`, and every such bound is midnight local, not midnight UTC. If no Notion tool takes a date bound, it uses `notion-list-recent-pages` (or the closest read there is), says that Notion's own tools offer no date filter, and still names the window it is asking about.
- Lists the pages it found by title with when each changed, or says that nothing changed in that window
- If the result is empty, says which window and filters it used, and that Notion's own permissions limit what it can see, without guessing another cause

## Forbidden
- A UTC-only week, for example starting at `00:00:00Z` on the Monday rather than local midnight
- A bare week number or "this week" with no dates given
- Claiming a cause for an empty result (a deleted page, a permission problem) that no tool result shows
- Any write
