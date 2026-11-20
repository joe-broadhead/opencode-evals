// Fake mode (`accounts: "fake"`, the setting of GitHub and Jira): the plugin is measured with no account and no real endpoint.
//
//   - the harness's own fake MCP server (src/fake/mcp-server.ts) starts inside the trial and serves the plugin's RELEASED tool list from
//     `packs/<id>/mcp.json` (names, descriptions, input schemas, annotations), so the model sees the tools a user sees;
//   - it answers from a small synthetic fixture (src/fake/fixtures/<id>.mjs): invented names only, never real data;
//   - the plugin itself runs as released, on its DEFAULT vendor URL. A server of its own name in the config (a loopback override) is a "conflict" to both plugins:
//     they drop their namespace text and tool filter. So the trial maps the vendor's host name to the fake (`--add-host`), keeps it off the egress proxy
//     (NO_PROXY) and the fake answers TLS with a certificate of a per-batch, name-constrained CA that only that trial trusts (NODE_EXTRA_CA_CERTS);
//   - writes are still asked and declined by the config's asks and graded at the declined call; a read is graded on tool choice and arguments, and on an
//     outcome item against the fixture's facts (`@fixture.<plugin>.<fact>`);
//   - nothing real is reachable: no credential is given, and the egress proxy refuses api.github.com, *.atlassian.net and the vendors' MCP hosts.

import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { makeFakeCa } from "./fake-ca.mjs"

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

/**
 * Where each fake plugin's DEFAULT vendor host lives inside a trial: its own loopback address, so two fake plugins share no port. The plugin registers its own server at
 * its default URL (GitHub https://api.githubcopilot.com/mcp/, Jira https://mcp.atlassian.com/v2/mcp?tools=all), which is what makes it run as released: with the
 * server in the user's config at a loopback URL, both plugins see a conflicting server of their own name, drop their namespace text and tool filter, and
 * report `conflict`. The trial maps the host name to this address and keeps it off the egress proxy, and the fake answers TLS for it (src/run/fake-ca.mjs).
 */
export const FAKE_HOSTS = Object.freeze({
  github: Object.freeze({ host: "api.githubcopilot.com", ip: "127.0.0.2" }),
  jira: Object.freeze({ host: "mcp.atlassian.com", ip: "127.0.0.3" }),
})

/** The `hosts` a trial maps to loopback, for the fake plugins `ids`: `[{ host, ip }]`. */
export const hostsFor = (ids) => ids.map((id) => ({ id, ...FAKE_HOSTS[id] }))

/**
 * Copies the fake server, its fixtures and the catalogs of the plugins in `ids` into `<harness>/fake`, where a trial's container can read them, and makes the
 * batch's throwaway CA with a leaf for each plugin's vendor host (`<harness>/fake/tls`). Returns `{ dir, ca, leaves }`.
 */
export function installFake(harnessDir, ids) {
  const dir = join(harnessDir, "fake")
  mkdirSync(join(dir, "fixtures"), { recursive: true, mode: 0o700 })
  cpSync(join(FAKE_SOURCE, "mcp-server.ts"), join(dir, "mcp-server.ts"))
  for (const id of ids) {
    if (!readCatalog(id)) throw new Error(`fake mode for ${id}: packs/${id}/mcp.json does not exist (node scripts/mcp-catalog.mjs builds it)`)
    if (!FAKE_HOSTS[id]) throw new Error(`fake mode for ${id}: no vendor host is known for it (FAKE_HOSTS in src/run/fake-mode.mjs)`)
    cpSync(catalogFile(id), join(dir, `${id}.catalog.json`))
  }
  // The whole fixtures directory: a fixture imports the shared date helper (fixtures/when.mjs).
  cpSync(join(FAKE_SOURCE, "fixtures"), join(dir, "fixtures"), { recursive: true })
  const tls = makeFakeCa(join(dir, "tls"), Object.fromEntries(ids.map((id) => [id, FAKE_HOSTS[id].host])))
  return { dir, ...tls }
}
