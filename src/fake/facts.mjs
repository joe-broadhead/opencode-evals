// The facts of each fake fixture (src/fake/fixtures/<plugin>.mjs), for the grader's `@fixture.<plugin>.<fact>` clause and for compile's check that the fact exists.
import { facts as github } from "./fixtures/github.mjs"
import { facts as jira } from "./fixtures/jira.mjs"

const FIXTURES = { github, jira }

/** The facts of a plugin's fixture, or null when it has none. */
export const fixtureFacts = (plugin) => FIXTURES[plugin] ?? null
fixtureFacts.known = () => Object.keys(FIXTURES)
