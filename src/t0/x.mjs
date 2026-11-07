// T0: static checks for the X plugin. No model, no network, no host — it reads the repository and the
// compiled cases, and decides the things that can be decided before anything runs.
//
// Every check is a fact about the artefact: a skill that does not parse, a tool named in a skill that does
// not exist, a deny-listed tool exposed as a method, a description without the exclusion clause that cost
// us a billed search in nx1.

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null)

const stringsIn = (block) => [...block.matchAll(/"([^"\n]+)"/g)].map((m) => m[1])

/** `export const READ_TOOLS: readonly string[] = [ … ]` */
export function extractList(source, name) {
  const at = source.indexOf(`export const ${name}`)
  if (at < 0) return null
  // The type annotation holds a `[]` before the value does; the value starts after the "=".
  const equals = source.indexOf("=", at)
  const open = source.indexOf("[", equals < 0 ? at : equals)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === "[") depth++
    else if (source[i] === "]") {
      depth--
      if (depth === 0) return stringsIn(source.slice(open, i + 1))
    }
  }
  return null
}

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

const PLACEHOLDER_HANDLES = new Set(["handle", "user", "username", "someone", "person", "name", "theirs", "author"])

const TRIGGER_TERMS = ["X", "Twitter", "x.com", "X handle", "handle", "mentions", "timeline", "bookmarks", "post", "posts", "tweet", "tweets", "profile", "credit"]

const wordish = (haystack, needle) => {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, needle === "X" ? "" : "i").test(haystack)
}

/**
 * @param {string} root the plugin checkout
 * @param {string} casesDir compiled cases
 * @param {Array} cases compiled case objects
 */
export function checkX(root, casesDir, cases) {
  const checks = []
  const check = (id, name, severity, run) => {
    try {
      const result = run()
      checks.push({ id, name, severity, ok: result.ok, detail: result.detail, data: result.data })
    } catch (error) {
      checks.push({ id, name, severity, ok: false, detail: `threw: ${error.message}` })
    }
  }

  const pkg = JSON.parse(read(join(root, "package.json")) ?? "{}")
  const toolsSrc = read(join(root, "src/x-tools.ts")) ?? ""
  const constantsSrc = read(join(root, "src/constants.ts")) ?? ""
  const skillsSrc = read(join(root, "src/skills.ts")) ?? ""
  const rpcSrc = read(join(root, "src/host/tools-rpc.ts")) ?? ""

  const read$ = extractList(toolsSrc, "READ_TOOLS") ?? []
  const parameterNames = new Set([...toolsSrc.matchAll(/"([a-z0-9_]+)(?:\*)?:(?:string|number|boolean|array<[^>]+>|object)"/g)].map((m) => m[1]))
  const write$ = extractList(toolsSrc, "WRITE_TOOLS") ?? []
  const public$ = extractList(toolsSrc, "PUBLIC_TOOLS") ?? []
  const deny$ = extractList(toolsSrc, "DENY_TOOLS") ?? []
  const all = new Set([...read$, ...write$, ...public$, ...deny$])

  const skillDirs = existsSync(join(root, "skills")) ? readdirSync(join(root, "skills")).filter((d) => existsSync(join(root, "skills", d, "SKILL.md"))) : []
  const skills = skillDirs.map((dir) => ({ dir, ...frontmatter(read(join(root, "skills", dir, "SKILL.md"))) }))
  const declared = (skillsSrc.match(/SKILL_NAMES[^=]*=\s*\[([^\]]*)\]/) ?? [])[1] ?? ""
  const declaredNames = stringsIn(declared)
  const jellySkills = pkg?.jelly?.skills ?? []
  const jellyTools = (pkg?.jelly?.tools ?? []).map((t) => String(typeof t === "object" && t !== null ? t.name : t).replace(/^x[._]/, ""))

  check("X-T0-01", "every skill parses and is named after its directory", "error", () => {
    const broken = skills.filter((s) => !s.fields || s.fields.name !== s.dir)
    return { ok: broken.length === 0, detail: broken.length ? `broken: ${broken.map((s) => s.dir).join(", ")}` : `${skills.length} skills parse` }
  })

  check("X-T0-02", "descriptions are one line and within the 1024-character limit", "error", () => {
    const bad = skills.filter((s) => !s.fields?.description || s.fields.description.includes("\n") || s.fields.description.length > 1024)
    const sizes = skills.map((s) => `${s.dir} ${s.fields?.description?.length ?? 0}`).join(", ")
    return { ok: bad.length === 0, detail: bad.length ? `bad: ${bad.map((s) => s.dir).join(", ")}` : sizes }
  })

  check("X-T0-03", "the declared skills, the directories and jelly.skills agree", "error", () => {
    const a = [...declaredNames].sort().join(",")
    const b = [...skillDirs].sort().join(",")
    const c = [...jellySkills].map((s) => String(s).replace(/^x_/, "")).sort().join(",")
    return { ok: a === b && b === c, detail: `src ${a} | dirs ${b} | jelly ${c}` }
  })

  check("X-T0-04", "jelly.tools is exactly the four classified tables", "error", () => {
    const declaredTools = [...jellyTools].sort()
    const known = [...all].sort()
    const missing = known.filter((t) => !declaredTools.includes(t))
    const extra = declaredTools.filter((t) => !all.has(t))
    return { ok: missing.length === 0 && extra.length === 0, detail: `${known.length} known, ${declaredTools.length} declared${missing.length ? `, missing ${missing.join(",")}` : ""}${extra.length ? `, undeclared ${extra.join(",")}` : ""}` }
  })

  check("X-T0-05", "the tools RPC exposes reads only", "error", () => {
    const mentionsRead = rpcSrc.includes("READ_TOOLS")
    const forbidden = [...all].filter((t) => !read$.includes(t) && new RegExp(`"${t}"`).test(rpcSrc))
    return { ok: mentionsRead && forbidden.length === 0, detail: forbidden.length ? `non-read tools named in the RPC: ${forbidden.join(",")}` : "methods derive from READ_TOOLS" }
  })

  check("X-T0-06", "no tool is both denied and available", "error", () => {
    const clash = [...deny$].filter((t) => read$.includes(t) || write$.includes(t) || public$.includes(t))
    return { ok: clash.length === 0, detail: clash.length ? `clash: ${clash.join(",")}` : `${deny$.length} denied, no overlap` }
  })

  check("X-T0-07", "every parameter table names a known tool", "error", () => {
    const start = toolsSrc.indexOf("export const PARAMETERS")
    const open = toolsSrc.indexOf("{", start)
    let depth = 0
    let end = -1
    for (let i = open; i < toolsSrc.length && end < 0; i++) {
      if (toolsSrc[i] === "{") depth++
      else if (toolsSrc[i] === "}" && --depth === 0) end = i
    }
    const block = end > 0 ? toolsSrc.slice(open, end) : ""
    const keys = [...block.matchAll(/^\s{2}"?([a-z0-9_]+)"?:/gm)].map((m) => m[1])
    const unknown = keys.filter((k) => !all.has(k))
    return { ok: unknown.length === 0, detail: unknown.length ? `unknown: ${unknown.join(",")}` : `${keys.length} parameter entries` }
  })

  check("X-T0-08", "every tool a skill names exists in the tool table", "error", () => {
    const VERB = /^(get|search|list|create|delete|update|add|remove|follow|unfollow|like|unlike|post|article|send|set|pin|unpin|accept|archive|cancel|schedule|mute|block|upload|repost|quote|bookmark)_[a-z0-9_]+$/
    const named = new Map()
    for (const skill of skills) {
      const body = skill.body ?? ""
      for (const m of body.matchAll(/`([a-z][a-z0-9_.]+)`/g)) {
        const raw = m[1]
        const name = raw.replace(/^x_/, "").replace(/^tools\.x\./, "")
        // A backticked parameter (`start_time`) is not a tool; a backticked verb_noun is.
        if (parameterNames.has(name) || /_(id|ids|time|fields|count|token|url|text|key|name|type|state|media|version)$/.test(name)) continue
        if (!VERB.test(name) && !all.has(name)) continue
        if (!named.has(name)) named.set(name, [])
        named.get(name).push(skill.dir)
      }
    }
    const unknown = [...named.keys()].filter((n) => !all.has(n))
    return {
      ok: unknown.length === 0,
      detail: unknown.length ? `unknown in skills: ${unknown.map((n) => `${n} (${named.get(n).join(",")})`).join("; ")}` : `${named.size} distinct tools named across ${skills.length} skills`,
    }
  })

  check("X-T0-09", "no machine-local path, real handle or status link in model-facing skill text", "error", () => {
    const problems = []
    for (const skill of skills) {
      const body = skill.body ?? ""
      if (/\/Users\/|\/private\/var\/|\.\.\/\.\.\//.test(body)) problems.push(`${skill.dir}: machine path`)
      if (/https?:\/\/x\.com\/[A-Za-z0-9_]+\/status\/[0-9]+/.test(body)) problems.push(`${skill.dir}: real status link`)
      const handles = [...body.matchAll(/@([A-Za-z0-9_]{3,})/g)].map((m) => m[1]).filter((h) => !PLACEHOLDER_HANDLES.has(h.toLowerCase()))
      if (handles.length) problems.push(`${skill.dir}: ${handles.length} real handle(s)`)
    }
    return { ok: problems.length === 0, detail: problems.length ? problems.join("; ") : "clean" }
  })

  const namespace = (constantsSrc.match(/NAMESPACE_DESCRIPTION\s*=\s*\n?\s*"((?:[^"\\]|\\.)*)"/) ?? [])[1] ?? ""
  check("X-T0-10", "the namespace text names the skill, the cap and the cost rule", "warn", () => {
    const tokens = Math.ceil(namespace.length / 4)
    const parts = {
      skill: /read the x skill/i.test(namespace),
      cap: /one page of at most ten|at most ten/i.test(namespace),
      cost: /cost:/i.test(namespace),
      noEstimate: /never an estimate/i.test(namespace),
    }
    return {
      ok: Object.values(parts).every(Boolean),
      detail: `~${tokens} tokens per turn; ${Object.entries(parts).map(([k, v]) => `${k}=${v ? "yes" : "NO"}`).join(" ")}`,
      data: { tokens_per_turn: tokens },
    }
  })

  // Triggering: a should-fire prompt should name something the description names; a should-not-fire
  // prompt should not. The second is the failure that cost a billed search in nx1.
  const xSkill = skills.find((s) => s.dir === "x")
  const description = xSkill?.fields?.description ?? ""
  const descriptionOf = (dir) => skills.find((s) => s.dir === dir)?.fields?.description ?? description
  const terms = TRIGGER_TERMS.filter((t) => wordish(description, t))
  // A case's prompt is checked against the description of the skill it names, with placeholders removed:
  // `<X test topic>` is not a mention of X.
  const bare = (text) => String(text ?? "").replace(/<[^>]*>/g, " ")
  const shouldFire = cases.filter((c) => c.expect !== "fail" && (c.skill || "").startsWith("x"))
  const shouldNot = cases.filter((c) => c.expect === "fail")
  const STOP = new Set(["that", "this", "with", "from", "have", "what", "when", "about", "into", "over", "only", "your", "their", "there", "then", "than", "they", "them", "will", "would", "should", "could", "make", "made", "like", "some", "more", "most", "also", "just", "very", "each", "every", "before", "after", "which", "where", "while", "because", "never", "always", "still", "whenever"])
  const contentWords = (text) => {
    const raw = String(text ?? "")
    const words = raw
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
    // "X" is the platform's name, and a one-letter word is normally noise; a standalone capital X is not.
    if (/(^|[^A-Za-z])X([^A-Za-z]|$)/.test(raw)) words.push("x")
    return words
  }
  const shares = (a, b) => {
    const left = contentWords(a)
    const right = contentWords(b)
    const hits = new Set()
    for (const x of left) for (const y of right) {
      if (x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)))) hits.add(x.length <= y.length ? x : y)
    }
    return [...hits]
  }
  const recall = shouldFire.map((c) => {
    const want = (c.skill || "x").split(/[\s,(]/)[0]
    return { id: c.id, skill: want, hits: shares(bare(c.prompt), descriptionOf(want)) }
  })
  const precision = shouldNot.map((c) => ({ id: c.id, hits: terms.filter((t) => wordish(bare(c.prompt), t)) }))

  check("X-T0-11", "the x description has an exclusion clause for the bare topic question", "error", () => ({
    ok: /never load this for/i.test(description) && /what are people saying about/i.test(description),
    detail: /never load this for/i.test(description) ? "exclusion clause present" : "no \"Never load this for\" clause: the nx1 over-trigger is unguarded",
  }))

  check("X-T0-12", "a should-fire prompt names a term the description names", "warn", () => {
    const misses = recall.filter((r) => r.hits.length === 0)
    return { ok: misses.length === 0, detail: `${recall.length - misses.length}/${recall.length} prompts name a description term${misses.length ? `; silent: ${misses.map((m) => m.id).join(", ")}` : ""}`, data: { recall, precision, terms } }
  })

  check("X-T0-13", "no should-not-fire prompt is a near-miss the description cannot exclude", "warn", () => {
    const risky = precision.filter((p) => p.hits.includes("X") || p.hits.includes("x.com"))
    return { ok: risky.length === 0, detail: risky.length ? `contains X-shaped terms: ${risky.map((r) => r.id).join(", ")}` : "no X-shaped terms in should-not-fire prompts", data: { precision } }
  })

  const failed = checks.filter((c) => !c.ok && c.severity === "error")
  const warned = checks.filter((c) => !c.ok && c.severity === "warn")
  const text = [
    `# T0 — X plugin static checks`,
    "",
    `${checks.length - failed.length - warned.length}/${checks.length} pass, ${warned.length} warn, ${failed.length} fail. Root: \`${root}\``,
    "",
    "| Check | Severity | Result | Detail |",
    "| --- | --- | --- | --- |",
    ...checks.map((c) => `| ${c.id} ${c.name} | ${c.severity} | ${c.ok ? "pass" : c.severity === "warn" ? "**warn**" : "**FAIL**"} | ${String(c.detail).replace(/\|/g, "\\|")} |`),
    "",
    terms.length ? `Trigger terms found in the \`x\` description: ${terms.join(", ")}.` : "",
  ].join("\n")

  return {
    plugin: "x",
    root,
    checks,
    failed: failed.length,
    warned: warned.length,
    namespaces: { tokens_per_turn: Math.ceil(namespace.length / 4) },
    trigger: { terms, recall, precision },
    text,
  }
}
