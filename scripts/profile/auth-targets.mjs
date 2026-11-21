// The name `opencode auth export` (and `auth login`) knows a vendor's integration by, where it is not the vendor's own
// id. `auth export <name>` resolves a registered integration by exact id, then by its unique case-insensitive name: gws
// registers as `gws-default`; an MCP server registers under its server name (the plugins rename it to "Slack", "Affinity",
// "Wispr Flow"), while its credential's integration id is `mcp_<sha1(name\0url)>`. The walk and the harness share this map.

export const LOGIN_TARGET = Object.freeze({ gws: "gws-default", wisprflow: "Wispr Flow" })

export const exportTarget = (integration) => LOGIN_TARGET[integration] ?? integration

/** The integrations that store a vendor's app client (a `key`: the client id, with any secret in its metadata), for the
 * two vendors whose MCP server is registered only when one is present: Slack's `slack-app`, X's `x-app`. */
export const APP_CLIENT = Object.freeze({ slack: "slack-app", x: "x-app" })
