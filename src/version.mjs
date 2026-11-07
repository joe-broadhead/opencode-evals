// The harness version, in every result. "<version>+<commit>" so a result is always attached to the code
// that produced it; "nogit" when the checkout has no history (a copied tree), which is a fact, not an error.
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

export const VERSION = "0.1.0-dev"
const ROOT = fileURLToPath(new URL("../", import.meta.url))

export function commit() {
  if (process.env.OPENCODE_EVALS_COMMIT) return process.env.OPENCODE_EVALS_COMMIT
  try {
    return execFileSync("git", ["-C", ROOT, "rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return "nogit"
  }
}

export const harnessVersion = () => `${VERSION}+${commit()}`
