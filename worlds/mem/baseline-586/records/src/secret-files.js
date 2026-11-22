/**
 * Secrets from files (`*_FILE`), read once at start (issue #39), as the
 * gateway reads `CONTROL_CELL_SECRETS_FILE`.
 *
 * For each NAME, when `NAME_FILE` is set, the file's content (without its
 * trailing newlines) becomes NAME and wins over NAME in the environment. So a
 * deployment can mount a root-owned file instead of passing the value through
 * `--env-file`, where `docker inspect` shows it. A file that cannot be read,
 * or is empty, fails startup. An error or a warning names the variable,
 * never the value.
 *
 * The control plane keeps its own copy of this module
 * (`control/src/secret-files.js`): each service is its own image.
 */
import fs from "node:fs"

/**
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} names the secret variables, without `_FILE`
 * @param {{ readFileImpl?: (path: string, encoding: "utf8") => string }} [options]
 * @returns {{ env: Record<string, string | undefined>, warnings: string[], fromFiles: string[] }}
 */
export function resolveSecretFiles(env, names, { readFileImpl = fs.readFileSync } = {}) {
  const resolved = { ...env }
  const warnings = []
  const fromFiles = []
  for (const name of names) {
    const variable = `${name}_FILE`
    const file = String(env[variable] ?? "").trim()
    if (!file) continue
    let raw
    try {
      raw = readFileImpl(file, "utf8")
    } catch (error) {
      throw new Error(`${variable} could not be read${typeof error?.code === "string" ? ` (${error.code})` : ""}`)
    }
    const value = String(raw).replace(/[\r\n]+$/, "")
    if (!value) throw new Error(`${variable} names an empty file`)
    if (env[name] !== undefined && env[name] !== "") warnings.push(`${variable} and ${name} are both set; the file wins`)
    resolved[name] = value
    delete resolved[variable]
    fromFiles.push(name)
  }
  return { env: resolved, warnings, fromFiles }
}
