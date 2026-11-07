// A standalone X fake: the plugin's own host-test fake, started as its own process. The module path comes
// from EVALS_FAKE_MODULE so a checkout path is configuration, never a constant in this repository.
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const port = Number(process.argv[2] ?? 0)
// Where the control files go: the run`s own directory, set by the T1 harness.
const home = process.env.EVALS_FAKE_HOME ?? process.env.HOME ?? "."
const options = JSON.parse(process.argv[3] ?? "{}")
const modulePath = process.env.EVALS_FAKE_MODULE
if (!modulePath) throw new Error("EVALS_FAKE_MODULE is not set")

const module = (await import(modulePath)) as {
  startFakeMcp: (options: Record<string, unknown>) => Promise<{ url: string; close: () => Promise<void> }>
}
const fake = await module.startFakeMcp({ catalog: "x", ...options })
writeFileSync(join(home, "fake.url"), `${fake.url}\n`)
// The call log, for the harness to read while the run is live.
const snapshot = () => {
  try {
    writeFileSync(join(home, "fake.calls.json"), JSON.stringify({ calls: fake.calls ?? [], arguments: fake.callArguments ?? [] }))
  } catch {
    // the control file is best-effort; a missing one is reported as no calls
  }
}
snapshot()
setInterval(snapshot, 200).unref()
process.on("SIGTERM", async () => {
  await fake.close().catch(() => {})
  process.exit(0)
})
await new Promise(() => {})
