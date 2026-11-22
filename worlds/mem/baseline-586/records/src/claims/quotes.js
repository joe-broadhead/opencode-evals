/**
 * A claim's words belong to the refs they came from, with that ref's author
 * (S2 re-review, H1 and H2). The claim keeps a map for quotes, statements and
 * authors, one entry per ref; the display quote and statement are the first
 * live ref's. Forgetting a ref removes its entries, and any word the forgotten
 * ref carried, so nothing of it survives.
 */

/** A map of ref to one value, with the value attributed to every ref of the filing. */
export function attributedMap(existing, refs, value) {
  const map = { ...(existing ?? {}) }
  if (!value) return map
  for (const ref of Array.isArray(refs) ? refs : []) {
    if (typeof ref === "string" && ref) map[ref] = value
  }
  return map
}

export function quoteMap(existing, refs, quote) {
  return attributedMap(existing, refs, quote)
}

/**
 * A statement is attributed to every ref of its filing. When a filing cites
 * several refs the words may come from any of them, so forgetting one of them
 * drops the words they shared (S2 third review, M1).
 */
export function statementMap(existing, refs, statement) {
  return attributedMap(existing, refs, statement)
}

export function authorMap(existing, refs, author) {
  return attributedMap(existing, refs, author)
}

/** The value shown for a claim: the first ref that still has one. */
export function displayOf(refs, map) {
  for (const ref of Array.isArray(refs) ? refs : []) {
    if (map?.[ref]) return map[ref]
  }
  return ""
}

export function displayQuote(refs, quotes) {
  return displayOf(refs, quotes)
}

export function displayStatement(refs, statements) {
  return displayOf(refs, statements)
}

/**
 * The entries a claim keeps after some refs are forgotten. A value carried by a
 * forgotten ref goes everywhere: it may have been that item's words, so no copy
 * stays.
 */
export function keptAttribution(refs, goneRefs, map) {
  const gone = new Set()
  for (const ref of goneRefs) if (map?.[ref] !== undefined) gone.add(map[ref])
  const out = {}
  for (const ref of Array.isArray(refs) ? refs : []) {
    if (goneRefs.has(ref)) continue
    const value = map?.[ref]
    if (value !== undefined && !gone.has(value)) out[ref] = value
  }
  return out
}

/**
 * The entries a claim keeps, by ref alone. A statement is attributed to the one
 * ref its sighting came from, so forgetting another ref leaves it untouched.
 */
export function keptByRef(refs, goneRefs, map) {
  const out = {}
  for (const ref of Array.isArray(refs) ? refs : []) {
    if (goneRefs.has(ref)) continue
    if (map?.[ref] !== undefined) out[ref] = map[ref]
  }
  return out
}

/** The authors of the refs a claim keeps. */
export function keptAuthors(refs, goneRefs, authors) {
  const out = {}
  for (const ref of Array.isArray(refs) ? refs : []) {
    if (goneRefs.has(ref)) continue
    if (authors?.[ref]) out[ref] = authors[ref]
  }
  return out
}
