// What a tool returned, as counts only. The graders need "10 posts, 9 authors" to check a cost line;
// they never need the posts. A tool with no extractor keeps only its byte count.

const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v)

/**
 * The first JSON value in a string. Code Mode's output can carry more than one thing: a returned object
 * followed by text a `shapeResult` appended (X appends its cost line), so a plain JSON.parse fails on
 * the whole string. Brace counting, string-aware, then ignore the suffix.
 */
export function parseFirstJson(raw) {
  const text = String(raw ?? "").trim()
  if (!text) return undefined
  const start = text.search(/[[{]/)
  if (start < 0) return undefined
  let depth = 0
  let quote = null
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === "\\") i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"') {
      quote = ch
      continue
    }
    if (ch === "{" || ch === "[") depth++
    else if (ch === "}" || ch === "]") {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

/** Code Mode's returned object is often `{localVar: result, …}`; the tool's payload is the object value. */
function unwrap(value) {
  if (!isObject(value)) return value
  // Already a payload: an X response has data, includes, meta or errors at this level.
  if (["data", "includes", "meta", "errors"].some((key) => key in value)) return value
  for (const key of ["r", "result", "value", "response"]) {
    if (isObject(value[key])) return value[key]
  }
  return value
}

const users = (r) => r?.includes?.users?.length ?? 0
const posts = (r) => (Array.isArray(r?.data) ? r.data.length : r?.data && typeof r.data === "object" ? 1 : 0)

const EXTRACTORS = {
  search_posts_all: (r) => ({ posts: posts(r), users: users(r) }),
  search_posts_recent: (r) => ({ posts: posts(r), users: users(r) }),
  search_users: (r) => ({ users: posts(r) }),
  get_posts_by_id: (r) => ({ posts: posts(r), users: users(r) }),
  get_posts_by_ids: (r) => ({ posts: posts(r), users: users(r) }),
  get_users_by_username: (r) => ({ users: posts(r) }),
  get_users_by_usernames: (r) => ({ users: posts(r) }),
  get_users_by_id: (r) => ({ users: posts(r) }),
  get_users_me: (r) => ({ users: posts(r) }),
  get_users_posts: (r) => ({ posts: posts(r), users: users(r) }),
  get_users_mentions: (r) => ({ posts: posts(r), users: users(r) }),
  get_users_timeline: (r) => ({ posts: posts(r), users: users(r) }),
  get_users_liked_posts: (r) => ({ posts: posts(r), users: users(r) }),
  get_users_bookmarks: (r) => ({ posts: posts(r), users: users(r) }),
  get_lists_posts: (r) => ({ posts: posts(r), users: users(r) }),
  get_spaces_posts: (r) => ({ posts: posts(r), users: users(r) }),
  get_posts_quoted_posts: (r) => ({ posts: posts(r), users: users(r) }),
  get_posts_liking_users: (r) => ({ users: posts(r), authors: users(r) }),
  get_posts_reposted_by: (r) => ({ users: posts(r), authors: users(r) }),
  get_posts_counts_recent: (r) => ({
    buckets: posts(r),
    total: Array.isArray(r?.data) ? r.data.reduce((n, b) => n + Number(b?.tweet_count ?? b?.total_tweet_count ?? 0), 0) : 0,
  }),
  get_usage_credits: (r) => ({ fields: Object.keys(r?.data ?? r ?? {}).sort() }),
}

/** Counts only; never the content. */
export function resultCounts(tool, output) {
  const parsed = parseFirstJson(output)
  if (parsed === undefined) return null
  const extractor = EXTRACTORS[tool]
  if (!extractor) return {}
  try {
    return extractor(unwrap(parsed))
  } catch {
    return {}
  }
}

export const knownExtractor = (tool) => Object.hasOwn(EXTRACTORS, tool)

const UNIT = /^[a-z][a-z -]{0,24}$/
const SAFE_UNITS = new Set([
  "posts", "post", "authors", "author", "users", "user", "count read", "own-account lookup",
  "mention posts", "own posts", "bookmark", "bookmark change",
])

/**
 * A cost line the plugin appended after the result, as numbers only.
 *   Cost: 10 posts ($0.05) + 9 authors ($0.09) = $0.14.
 * -> { terms: [{n:10, unit:"posts", usd:0.05}, {n:9, unit:"authors", usd:0.09}], total_usd: 0.14 }
 * The unit words are the plugin's own vocabulary; anything else is replaced, so no post text can ride in.
 */
export function costLineOf(output) {
  const text = String(output ?? "")
  const at = text.lastIndexOf("Cost:")
  if (at < 0) return null
  const line = text.slice(at).split("\n")[0].trim()
  const terms = []
  const term = /(\d+)\s+([a-z][a-z -]{0,24}?)\s*\(\$(\d+(?:\.\d+)?)\)/gi
  let m
  while ((m = term.exec(line))) {
    const unit = m[2].trim().toLowerCase()
    terms.push({ n: Number(m[1]), unit: SAFE_UNITS.has(unit) && UNIT.test(unit) ? unit : "other", usd: Number(m[3]) })
  }
  const total = /=\s*\$(\d+(?:\.\d+)?)/.exec(line)
  if (!terms.length) return { terms: [], total_usd: total ? Number(total[1]) : null, parsed: "shape-only" }
  return { terms, total_usd: total ? Number(total[1]) : terms.reduce((n, t) => n + t.usd, 0), parsed: "terms" }
}
