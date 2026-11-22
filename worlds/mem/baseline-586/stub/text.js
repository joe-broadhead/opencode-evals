function tokens(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2)
}

export function score(query, text) {
  const q = [...new Set(tokens(query))]
  if (q.length === 0) return 0
  const haystack = String(text ?? "").toLowerCase()
  let hits = 0
  for (const token of q) if (haystack.includes(token)) hits += 1
  const coverage = hits / q.length
  return Math.min(1, coverage * 0.8 + (haystack.includes(String(query).toLowerCase()) ? 0.2 : 0))
}

const VISIBILITY_RANK = { private: 0, agent: 1, restricted: 2, team: 3 }

export function clampVisibility(values) {
  let best
  for (const value of values ?? []) {
    const key = String(value ?? "private").toLowerCase()
    if (best === undefined || (VISIBILITY_RANK[key] ?? 0) < (VISIBILITY_RANK[best] ?? 0)) best = key
  }
  return best ?? "private"
}

const INSTRUCTION = /\b(never|must|must not|don'?t|do not|always|avoid|constraint|required?)\b/i
const PERSONA = /\b(i am|i'm|my name|i prefer|i like|i use|we use|we always|our team)\b/i

export function classify(sentence) {
  if (INSTRUCTION.test(sentence)) return "instruction"
  if (PERSONA.test(sentence)) return "persona"
  return "episodic"
}

export function normalise(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const FUNCTION_WORDS = new Set(
  "the a an and or but of to in on at by for from with into is are was were be been being it its this that these those we our you your they their i my me will would should can could must may might do does did has have had not no as so than then there here".split(" "),
)

/** The rewriting extractor's paraphrase of one sentence (see EXTRACT). */
export function paraphrase(sentence) {
  const specific = []
  const content = []
  sentence.split(/\s+/).forEach((raw, index) => {
    const word = raw.replace(/^[^A-Za-z0-9`"]+|[^A-Za-z0-9`"]+$/g, "")
    if (!word) return
    const kept =
      /[0-9]/.test(word) ||
      /[A-Za-z0-9][_./:@#$-][A-Za-z0-9]/.test(word) ||
      /[`"]/.test(word) ||
      (index > 0 && /[A-Z]/.test(word))
    if (kept) specific.push(word)
    else if (word.length >= 4 && !FUNCTION_WORDS.has(word.toLowerCase())) content.push(word.toLowerCase())
  })
  const words = content.filter((_, index) => index % 2 === 0).map((word) => (word.endsWith("s") ? word.slice(0, -1) : `${word}s`))
  const head = words.length > 0 ? words.join(" ") : "detail"
  const lead = `${head[0].toUpperCase()}${head.slice(1)}`
  return specific.length > 0 ? `${lead}: ${specific.join(", ")}.` : `${lead}.`
}
