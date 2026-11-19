// Fake mode (`accounts: "fake"`, the setting of GitHub and Jira): the plugin is measured with no account and no real endpoint.
//
//   - the harness's own fake MCP server (src/fake/mcp-server.ts) starts inside the trial and serves the plugin's RELEASED tool list from
//     `packs/<id>/mcp.json` (names, descriptions, input schemas, annotations), so the model sees the tools a user sees;
//   - it answers from a small synthetic fixture (src/fake/fixtures/<id>.mjs): invented names only, never real data;
//   - the plugin itself runs as released. It has no server-URL option (GitHub's only `host` is for GitHub Enterprise Server, which registers no server;
//     Jira's endpoint is a constant), so the sealed config carries an MCP override: a server of the plugin's own name, which the plugin leaves untouched
//     when the user's config names one (its documented rule), pointing at the fake on loopback;
//   - writes are still asked and declined by the config's asks and graded at the declined call; a read is graded on tool choice and arguments, and on an
//     outcome item against the fixture's facts (`@fixture.<plugin>.<fact>`);
//   - nothing real is reachable: no credential is given, and the egress proxy refuses api.github.com, *.atlassian.net and the vendors' MCP hosts.

import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..", "..")
export const FAKE_SOURCE = join(ROOT, "src", "fake")

/** The vendors' hosts a fake-mode trial must never reach: the proxy refuses them (none is on any batch's allow-list without a credential). */
export const REAL_HOSTS = Object.freeze({ github: ["api.github.com", "api.githubcopilot.com", "github.com", "uploads.github.com"], jira: ["mcp.atlassian.com", "api.atlassian.com", "auth.atlassian.com", "quill-labs.atlassian.net", "example.atlassian.net"] })

export const catalogFile = (id, root = ROOT) => join(root, "packs", id, "mcp.json")

/** A plugin's catalog (`packs/<id>/mcp.json`), or null when it has none. */
export function readCatalog(id, root = ROOT) {
  const file = catalogFile(id, root)
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null
}

/** The fake plugins a case uses: its own and every one its `Seed: plugins=` names, in fake mode. */
export const fakeFor = (plugins, fake) => plugins.filter((id) => fake.has(id))

/** The MCP override of the sealed config: server name -> a remote server on the fake's loopback port. */
export function mcpOverride(ports) {
  return Object.fromEntries(Object.entries(ports).map(([id, port]) => [readCatalog(id)?.server ?? id, { type: "remote", url: `http://127.0.0.1:${port}/mcp` }]))
}

/** Copies the fake server, its fixtures and the catalogs of the plugins in `ids` into `<harness>/fake`, where a trial's container can read them. */
export function installFake(harnessDir, ids) {
  const dir = join(harnessDir, "fake")
  mkdirSync(join(dir, "fixtures"), { recursive: true, mode: 0o700 })
  cpSync(join(FAKE_SOURCE, "mcp-server.ts"), join(dir, "mcp-server.ts"))
  for (const id of ids) {
    if (!readCatalog(id)) throw new Error(`fake mode for ${id}: packs/${id}/mcp.json does not exist (node scripts/mcp-catalog.mjs builds it)`)
    cpSync(catalogFile(id), join(dir, `${id}.catalog.json`))
    cpSync(join(FAKE_SOURCE, "fixtures", `${id}.mjs`), join(dir, "fixtures", `${id}.mjs`))
  }
  return dir
}
