// Cost, from the trace. Two sources, each tagged: the model's tokens through a price table the owner
// supplies, and the vendor's resources through the rates the plugin itself publishes. A price we do not
// have is "missing", never a number we made up.

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

export const loadPrices = (file = join(import.meta.dirname, "prices.json")) => JSON.parse(readFileSync(file, "utf8"))

const X_OWN_READS = new Set(["get_users_me", "get_users_mentions", "get_users_bookmarks", "get_users_posts", "get_users_timeline", "get_users_liked_posts"])

/**
 * A vendor's cost from the resources a run actually consumed, which the trace records as counts. For X:
 * a post read is priced per post plus per author, an Owned Read per post, a count read flat.
 */
export function vendorCost(calls, vendor, prices) {
  const rates = prices?.vendors?.[vendor]
  if (!rates) return { amount_usd: null, source: "missing", resources: {} }
  let total = 0
  let priced = true
  const resources = {}
  const add = (name, n, rate) => {
    if (!n) return
    resources[name] = (resources[name] ?? 0) + n
    total += n * rate
  }
  for (const call of calls) {
    const counts = call.counts ?? {}
    const posts = counts.posts ?? 0
    const users = counts.users ?? 0
    if (call.tool === "search_posts_all" || call.tool === "search_posts_recent" || call.tool === "get_posts_by_id") {
      add("posts", posts, rates.post_read)
      add("authors", users, rates.author_read)
    } else if (X_OWN_READS.has(call.tool)) {
      add("own_posts", posts, rates.own_read)
    } else if (call.tool === "get_users_by_username" || call.tool === "get_users_by_id" || call.tool === "search_users") {
      add("users", users || 1, rates.author_read)
    } else if (call.tool === "get_posts_counts_recent") {
      add("count_reads", 1, rates.count_read)
    } else if (call.tool === "create_posts") {
      const text = JSON.stringify(call.args ?? {})
      add("posts_created", 1, /https?:/.test(text) ? rates.post_create_with_link : rates.post_create)
    } else if (call.tool === "create_users_bookmark" || call.tool === "delete_users_bookmark") {
      add("bookmark_changes", 1, rates.bookmark_change)
    } else if (call.tool === "get_usage_credits") {
      add("usage_reads", 1, rates.usage_credits)
    } else if (call.counts_known === false) {
      priced = false
    }
  }
  return { amount_usd: priced ? Math.round(total * 1e6) / 1e6 : null, source: "table", as_of: rates.as_of ?? null, source_note: rates.source ?? null, resources }
}

/** Everything a batch cost, with the sources that were actually available. */
export function batchCost({ run, calls, vendor, prices }) {
  const model_ = run
  const vendor_ = vendorCost(calls ?? [], vendor, prices)
  const total = model_.amount_usd === null || vendor_.amount_usd === null ? null : model_.amount_usd + vendor_.amount_usd
  return {
    amount_usd: total,
    model: model_,
    vendor: vendor_,
    source: model_?.source ?? "missing",
  }
}
