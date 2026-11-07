// T0 for any plugin: the declaration against itself. Everything here reads the checkout and the pack —
// `package.json`'s `jelly` section, the skills, and any namespace text — and decides in code. The X plugin
// adds its own deeper checks on top (src/t0/x.mjs), but every plugin gets these.

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { snapshotChecks } from "../pack/snapshot.mjs"

const PLACEHOLDER_HANDLES = new Set(["handle", "user", "username", "someone", "person", "name", "theirs", "author", "channel", "email", "example"])

const frontmatter = (text) => {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(String(text ?? "").replace(/\r\n/g, "\n"))
  if (!match) return null
  const fields = {}
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":")
    if (at < 0) continue
    fields[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["'](.*)["']$/, "$1")
  }
  return { fields, body: match[2] }
}

export function checkPack(pack, repo) {
  // With no checkout (CI), the snapshot's own checks stand: the pack against itself and the family's
  // invariants. They are weaker than reading the skills, and they say so.
  if (!repo) {
    const checks = snapshotChecks(pack)
    const failed = checks.filter((check) => !check.ok)
    return {
      plugin: pack.id,
      repo: null,
      source: "snapshot",
      checks,
      failed: failed.length,
      warned: 0,
      namespaces: pack.namespace_tokens ? { tokens_per_turn: pack.namespace_tokens } : null,
      text: [
        `# T0 — ${pack.name ?? pack.id} (snapshot)`,
        "",
        `${checks.length - failed.length}/${checks.length} pass. No checkout configured, so the skill files and the tool table were not read.`,
        "",
        "| Check | Result | Detail |",
        "| --- | --- | --- |",
        ...checks.map((check) => `| ${check.id} ${check.name} | ${check.ok ? "pass" : "**FAIL**"} | ${String(check.detail).replace(/\|/g, "\\|")} |`),
      ].join("\n"),
    }
  }
  const checks = []
  const add = (id, name, severity, ok, detail, data) => checks.push({ id, name, severity, ok, detail, data })
  const pkg = existsSync(join(repo, "package.json")) ? JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) : {}
  const jelly = pkg.jelly ?? {}
  const skillDirs = existsSync(join(repo, "skills")) ? readdirSync(join(repo, "skills")).filter((dir) => existsSync(join(repo, "skills", dir, "SKILL.md"))) : []
  const skills = skillDirs.map((dir) => ({ dir, ...frontmatter(readFileSync(join(repo, "skills", dir, "SKILL.md"), "utf8")) }))
  const declaredSkills = (jelly.skills ?? []).map((s) => String(s).replace(/^[a-z]+_/, ""))

  add("T0-01", "every skill parses and is named after its directory", "error",
    skills.length > 0 && skills.every((s) => s.fields && s.fields.name === s.dir),
    skills.length ? `${skills.length} skill(s): ${skills.map((s) => `${s.dir}${s.fields ? "" : " (broken)"}`).join(", ")}` : "no skills")

  add("T0-02", "descriptions are one line and within the 1024-character limit", "error",
    skills.every((s) => s.fields?.description && !s.fields.description.includes("\n") && s.fields.description.length <= 1024),
    skills.map((s) => `${s.dir} ${s.fields?.description?.length ?? 0}`).join(", ") || "none")

  add("T0-03", "the declared skills, the directories and jelly.skills agree", "error",
    [...declaredSkills].sort().join(",") === [...skillDirs].sort().join(","),
    `jelly ${declaredSkills.sort().join(",") || "-"} | dirs ${skillDirs.sort().join(",") || "-"}`)

  const tools = pack.tools ?? []
  const named = new Set(tools.map((t) => t.name))
  const actions = new Map()
  for (const tool of tools) {
    if (actions.has(tool.permission)) actions.set(tool.permission, actions.get(tool.permission) + 1)
    else actions.set(tool.permission, 1)
  }
  add("T0-04", "every declared tool has one permission action and one effect", "error",
    tools.length > 0 && [...actions.values()].every((n) => n === 1) && tools.every((t) => t.permission && ["allow", "ask", "deny"].includes(t.effect)),
    `${tools.length} tools, ${actions.size} distinct actions`)

  add("T0-05", "a denied tool is never declared available", "error",
    tools.every((t) => !(t.effect === "deny" && t.class === "read")),
    `${tools.filter((t) => t.effect === "deny").length} denied`)

  const VERB = /^(get|search|list|create|delete|update|add|remove|follow|unfollow|like|unlike|post|article|send|set|pin|unpin|accept|archive|cancel|schedule|mute|block|upload|repost|quote|bookmark)_[a-z0-9_]+$/
  const unknown = []
  for (const skill of skills) {
    for (const match of String(skill.body ?? "").matchAll(/`([a-z][a-z0-9_.]+)`/g)) {
      const raw = match[1]
      // Only a *prefixed* name is a tool reference (`x_search_posts_all`, `tools.x.search_posts_all`): a bare
      // backticked word is prose or a parameter, and flagging those would make the check useless.
      if (!/^(tools\.[a-z]+\.[a-z0-9_]+|[a-z]+_[a-z0-9_]+)$/.test(raw)) continue
      const bare = raw.replace(/^tools\.[a-z]+\./, "").replace(/^[a-z]+_/, "")
      if (named.has(bare) || named.has(raw)) continue
      if (/_(ids|id|time|fields|count|token|url|text|key|state)$/.test(bare)) continue
      if (!VERB.test(bare)) continue
      unknown.push(`${raw} (${skill.dir})`)
    }
  }
  add("T0-06", "every tool a skill names exists in the declaration", "error", unknown.length === 0, unknown.length ? unknown.slice(0, 5).join("; ") : "all named tools exist")

  const dirty = []
  for (const skill of skills) {
    const body = String(skill.body ?? "")
    if (/\/Users\/|\/private\/var\/|\.\.\/\.\.\//.test(body)) dirty.push(`${skill.dir}: machine path`)
    if (/https?:\/\/x\.com\/[A-Za-z0-9_]+\/status\/[0-9]{8,}/.test(body)) dirty.push(`${skill.dir}: real status link`)
    for (const match of body.matchAll(/@([A-Za-z0-9_]{3,})/g)) if (!PLACEHOLDER_HANDLES.has(match[1].toLowerCase())) dirty.push(`${skill.dir}: handle @${match[1]}`)
  }
  add("T0-07", "no machine path, real handle or status link in model-facing skill text", "error", dirty.length === 0, dirty.length ? dirty.slice(0, 4).join("; ") : "clean")

  // The namespace text is the per-turn prefix a Code Mode catalog carries; its size is a cost, not a fact.
  let namespace = ""
  for (const file of existsSync(join(repo, "src")) ? readdirSync(join(repo, "src")).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")) : []) {
    const text = readFileSync(join(repo, "src", file), "utf8")
    const match = /NAMESPACE_DESCRIPTION\s*=\s*\n?\s*"((?:[^"\\]|\\.)*)"/.exec(text)
    if (match) {
      namespace = match[1]
      break
    }
  }
  const tokens = Math.ceil(namespace.length / 4)
  add("T0-08", "the namespace text names the skills it relies on and is measured", "warn",
    namespace === "" || skills.some((skill) => new RegExp(`\\b${skill.dir}\\b`, "i").test(namespace)),
    namespace === "" ? "no namespace text" : `~${tokens} tokens per turn${skills.length ? `; names ${skills.filter((s) => new RegExp(`\\b${s.dir}\\b`, "i").test(namespace)).map((s) => s.dir).join(",") || "none"}` : ""}`,
    { tokens_per_turn: tokens })

  const failed = checks.filter((c) => !c.ok && c.severity === "error")
  return {
    plugin: pack.id,
    repo,
    checks,
    failed: failed.length,
    warned: checks.filter((c) => !c.ok && c.severity === "warn").length,
    namespaces: { tokens_per_turn: tokens },
    text: [
      `# T0 — ${pack.name ?? pack.id}`,
      "",
      `${checks.filter((c) => c.ok).length}/${checks.length} pass, ${checks.filter((c) => !c.ok && c.severity === "warn").length} warn, ${failed.length} fail.`,
      "",
      "| Check | Severity | Result | Detail |",
      "| --- | --- | --- | --- |",
      ...checks.map((c) => `| ${c.id} ${c.name} | ${c.severity} | ${c.ok ? "pass" : c.severity === "warn" ? "**warn**" : "**FAIL**"} | ${String(c.detail).replace(/\|/g, "\\|")} |`),
    ].join("\n"),
  }
}
