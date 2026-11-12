// Selecting calls: a clause names a tool exactly (`search_posts_all`), qualified by its namespace
// (`history.read`), by namespace (`x.*`), or by a glob (`x_*`).
//
// One plugin tool reaches a run two ways: inside Code Mode's `execute` (recorded as ns "history", tool "read") and as a
// direct tool (`history_read`, always for some tools, and for every tool when Code Mode is off). A qualified name and a
// namespace match both. A bare name the case's own plugin declares is qualified with that plugin's namespace before it
// is matched (`qualify`), so `call:read#1` in a History case is History's read, never the built-in file `read`; a bare
// name the plugin does not declare (`edit`, `write`, `bash`) is the built-in it names.

/** A bare tool name the case's plugin declares, qualified with the plugin's namespace; anything else as written. */
export function qualify(pattern, scope) {
  if (!scope?.ns || !pattern || pattern.includes(".") || pattern.includes("*")) return pattern
  return scope.tools?.has(pattern) ? `${scope.ns}.${pattern}` : pattern
}

/** Does one recorded call answer to this tool pattern? */
export function matchesTool(pattern, call) {
  if (!pattern) return false
  if (pattern.includes("*")) {
    if (pattern.endsWith(".*")) {
      const ns = pattern.slice(0, -2)
      // Every call in the namespace: Code Mode's inner calls, and the plugin's direct tools (`history_pin`).
      return call.ns === ns || (!isInnerCall(call) && call.tool.startsWith(`${ns}_`))
    }
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
    return re.test(call.tool)
  }
  const dot = pattern.indexOf(".")
  if (dot > 0) {
    // `history.read`: the inner call ns "history", tool "read", or the direct tool `history_read`. Never a bare `read`.
    const ns = pattern.slice(0, dot)
    const name = pattern.slice(dot + 1)
    if (call.ns) return call.ns === ns && call.tool === name
    return call.tool === `${ns}_${name}` || call.tool === pattern
  }
  if (call.tool === pattern) return true
  // `history_pin` names the inner call ns "history", tool "pin" too.
  if (call.ns && `${call.ns}_${call.tool}` === pattern) return true
  // A direct plugin tool id (`x_search_posts_all`) names the same thing as the MCP tool it wraps.
  return call.tool.replace(/^[a-z0-9]+_/, "") === pattern.replace(/^x_/, "")
}

const isInnerCall = (call) => call.via === "execute" && call.tool !== "execute"

export const selectCalls = (calls, pattern, scope = null) => {
  const qualified = qualify(pattern, scope)
  return calls.filter((call) => matchesTool(qualified, call))
}
