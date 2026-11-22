/**
 * How long a held write's corrected words may be, so that Jelly's confirmation
 * shows **every character that will land**.
 *
 * Jelly caps a confirmation's preview at 4,000 characters
 * (`ACTION_PREVIEW_MAX_CHARS`, `protocol/contracts/src/plugin-actions.ts:244`),
 * applied to the indented JSON of the preview's whole answer
 * (`backend/host/src/plugin-actions/service.ts:344,380`; `plain` at `:469`
 * slices past the cap and ends in `…`). So a preview is not only the words: it
 * carries the record's id, version, state, kind and space name, and the words
 * are JSON-escaped. That envelope is at most 500 characters for a held write
 * (a 200-character space name, a 30-character id and the fixed keys), which
 * leaves 3,500 for the text's JSON form: **counted escaped**, so quotes,
 * newlines and control characters cannot double it past the preview.
 *
 * The same limit is declared in `src/actions.js` for the preview and the press;
 * `test/actions-suggestions-held.test.js` holds the two to each other, so they
 * cannot disagree.
 */
export const HELD_EDITS_MAX = 3500

/** Jelly's cap on a confirmation's preview, as Jelly defines it. */
export const JELLY_PREVIEW_MAX_CHARS = 4000

/**
 * What is wrong with a held write's edited words, or null: their JSON form is
 * longer than the preview can show. The length is the one Jelly counts.
 *
 * @param {unknown} text
 * @returns {{ length: number, limit: number } | null}
 */
export function heldEditsProblem(text) {
  if (typeof text !== "string" || !text) return null
  // Jelly's `plain` measures a string's length, and its JSON view escapes the
  // text first: count the escaped form, so the tail cannot be cut.
  const length = JSON.stringify(text).length - 2
  return length > HELD_EDITS_MAX ? { length, limit: HELD_EDITS_MAX } : null
}
