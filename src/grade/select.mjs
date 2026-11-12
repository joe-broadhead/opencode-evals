// Selecting calls: a clause names a tool exactly (`search_posts_all`), qualified by its namespace
// (`history.read`), by namespace (`x.*`), or by a glob (`x_*`).
//
// One plugin tool reaches a run two ways: inside Code Mode's `execute` (recorded as ns "history", tool "read") and as a
// direct tool (`history_read`, always for some tools, and for every tool when Code Mode is off). A qualified name and a
// namespace match both. A bare name the case's own plugin declares is qualified with that plugin's namespace before it
// is matched (`qualify`), unless it is one of OpenCode's own tool names (BUILTIN_TOOLS): a bare `read`, `write` or
// `search` means every tool of that name, the built-in included, and only `history.read` means History's alone.

/**
 * OpenCode's own tool names, on every tested host (2.2.3 to 2.2.6): the tools `@opencode/core` registers from
 * `dist/tool/plugin/*` and Code Mode's `execute`, read from the pinned packages' registries:
 *   edit, glob, grep, experimental_image_generate, patch, question, read, shell, skill, subagent, todowrite, webfetch,
 *   websearch, write                                                     (the file, shell and web tools)
 *   list_mcp_resources, read_mcp_resource                                (mcp-resource.js)
 *   models, session_move, session_rename, worktree_create, worktree_list, worktree_remove   (opencode.js)
 *   schedule_create, schedule_delete, schedule_list, schedule_pause, schedule_resume         (schedule.js)
 *   artifact_create, artifact_delete, artifact_read, artifact_update     (artifact.js; 2.2.5 and later)
 * There is no `bash`, `task`, `list`, `todoread` or `apply_patch` in 2.2.x, and `search` is a function inside Code
 * Mode, not a tool. A bare one in a clause is never qualified with the case's plugin, so `absent:write` keeps checking
 * every write; a plugin's tool of the same name is written with its prefix, `history.read`, and `evals compile`
 * refuses a case that names one bare when its plugin declares a tool of that name.
 */
export const BUILTIN_TOOLS = Object.freeze([
  "artifact_create", "artifact_delete", "artifact_read", "artifact_update",
  "edit", "execute", "experimental_image_generate", "glob", "grep",
  "list_mcp_resources", "models", "patch", "question", "read", "read_mcp_resource",
  "schedule_create", "schedule_delete", "schedule_list", "schedule_pause", "schedule_resume",
  "session_move", "session_rename", "shell", "skill", "subagent", "todowrite", "webfetch", "websearch",
  "worktree_create", "worktree_list", "worktree_remove", "write",
])
const BUILTIN = new Set(BUILTIN_TOOLS)

/** A bare tool name the case's plugin declares, qualified with the plugin's namespace; a built-in name, and anything else, as written. */
export function qualify(pattern, scope) {
  if (!scope?.ns || !pattern || pattern.includes(".") || pattern.includes("*") || BUILTIN.has(pattern)) return pattern
  return scope.tools?.has(pattern) ? `${scope.ns}.${pattern}` : pattern
}

/** The bare names in a case that are both a built-in and a tool of its plugin: they mean every tool of that name. */
export function builtinCollisions(caseObject, pluginTools) {
  const tools = new Set(pluginTools)
  const found = new Set()
  for (const item of caseObject.items ?? []) {
    for (const clause of [...(item.evidence ?? []), ...(item.evidence_any ?? []).flat(), ...(item.na_when ?? [])]) {
      for (const name of [clause.tool, clause.other]) if (name && BUILTIN.has(name) && tools.has(name)) found.add(name)
    }
  }
  return [...found].sort()
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
