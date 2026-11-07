<!-- live checklist, unrun: copied from the review set (wisprflow/dictionary-edit-not-available.md). It compiles into a T3 case when the release sweep starts. -->
> Run: no. Tier: T3. Do not edit here: the review set is the source until the sweep compiles it.

# dictionary-edit-not-available
- Skill under test: wisprflow
- Decision tested: no tool edits the dictionary, snippets or styles. The model says so and points to the app, without reaching for a write tool.
- Data check: none (no tool call is needed)

## Prompt
add Kubernetes, Postgres and OpenCode to my Wispr Flow dictionary so it stops misspelling them

## Assertions
- The answer says the Wispr Flow connection can't change the dictionary
- The answer tells the user to add the words in the Wispr Flow app's Dictionary settings
- No `wisprflow_*` tool is called: none can read or change the dictionary

## Forbidden
- Calling any tool as a substitute way to add the words
- Editing files on disk, or running a shell command, to change Wispr Flow's dictionary
- Claiming the words were added
