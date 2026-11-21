// The name `opencode auth export` (and `auth login`) knows a vendor's credential by, where it is not the vendor's own
// id. `auth export <name>` selects a credential by its integration id or its label: gws is the integration `gws-default`,
// an MCP server (and Wispr Flow) is matched by the server's name, which the host stores as the credential's label while
// the integration id is `mcp_<hash>`. The walk and the harness share this one map.

export const LOGIN_TARGET = Object.freeze({ gws: "gws-default", wisprflow: "Wispr Flow" })

export const exportTarget = (integration) => LOGIN_TARGET[integration] ?? integration
