// Selecting calls: a clause names a tool exactly (`search_posts_all`), by namespace (`x.*`), or by a
// glob (`x_*`). The namespace form is how "no X call at all" is written, because Code Mode's inner calls
// carry their namespace separately from their name.

/** Does one recorded call answer to this tool pattern? */
export function matchesTool(pattern, call) {
  if (!pattern) return false
  if (pattern.includes("*")) {
    if (pattern.endsWith(".*")) {
      const ns = pattern.slice(0, -2)
      return call.ns === ns || call.tool === `${ns}.${call.tool}`
    }
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
    return re.test(call.tool)
  }
  if (call.tool === pattern) return true
  // An inner Code Mode call is recorded as {ns, tool}: `history.search` names the same call as ns "history", tool "search".
  if (call.ns && pattern.includes(".") && `${call.ns}.${call.tool}` === pattern) return true
  // A direct plugin tool id (`x_search_posts_all`) names the same thing as the MCP tool it wraps.
  return call.tool.replace(/^[a-z0-9]+_/, "") === pattern.replace(/^x_/, "")
}

export const selectCalls = (calls, pattern) => calls.filter((call) => matchesTool(pattern, call))
